// Command automix serves the map tool: the tilegen generators produce semantic
// maps, pkg/terrain turns them into shader materials, and the browser draws and
// walks them.
//
//	go run ./cmd/automix                 # http://127.0.0.1:7788
//	go run ./cmd/automix -dev            # serve web/static from disk
//	go run ./cmd/automix gen dungeon -p '{"levels":2}' -o /tmp/d.json
package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"automix/pkg/terrain"
	"automix/pkg/world"
	"automix/web"

	"tilegen/pkg/gen"
	"tilegen/pkg/semantic"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "gen" {
		genCmd(os.Args[2:])
		return
	}
	addr := flag.String("addr", "127.0.0.1:7788", "listen address")
	dev := flag.Bool("dev", false, "serve web/static from disk instead of the embedded copy")
	palPath := flag.String("palette", "", "palette JSON (default: embedded)")
	themeDir := flag.String("themes", "data/themes", "where saved themes go (built-ins are embedded)")
	flag.Parse()

	pal := loadPalette(*palPath)
	var static fs.FS = web.Static()
	if *dev {
		static = os.DirFS("web/static")
	}
	s := &server{pal: pal, b: world.NewBuilder(64), maps: map[string]*semantic.Map{}, themes: terrain.Themes{Dir: *themeDir}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/tools", s.tools)
	mux.HandleFunc("GET /api/palette", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, r, s.pal) })
	mux.HandleFunc("POST /api/generate/{tool}", s.generate)
	mux.HandleFunc("POST /api/world", s.world)
	mux.HandleFunc("GET /api/semantic/{id}", s.semantic)
	mux.HandleFunc("GET /api/lab", s.lab)
	mux.HandleFunc("GET /api/themes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, r, s.themes.List()) })
	mux.HandleFunc("GET /api/themes/{name}", s.getTheme)
	mux.HandleFunc("PUT /api/themes/{name}", s.saveTheme)
	files := http.FileServerFS(static)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Revalidate every time, or the browser keeps stale ES modules after edits.
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	log.Printf("automix on http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

func loadPalette(path string) *terrain.Palette {
	if path == "" {
		return terrain.Default()
	}
	b, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	p, err := terrain.ParsePalette(b)
	if err != nil {
		log.Fatal(err)
	}
	return p
}

type server struct {
	pal    *terrain.Palette
	b      *world.Builder
	themes terrain.Themes

	mu    sync.Mutex
	maps  map[string]*semantic.Map // last results, for the semantic export
	order []string
}

func (s *server) remember(id string, m *semantic.Map) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.maps[id]; !ok {
		s.order = append(s.order, id)
	}
	s.maps[id] = m
	for len(s.order) > 16 {
		delete(s.maps, s.order[0])
		s.order = s.order[1:]
	}
}

func (s *server) tools(w http.ResponseWriter, r *http.Request) {
	var out []gen.Info
	for _, t := range gen.All() {
		in := t.Info()
		if in.Name == "sample" {
			continue
		}
		if in.Name == "city" {
			// Handled here, not by the city tool: houses swapped for dwellings.
			in.Schema.Fields = append(append([]gen.Field(nil), in.Schema.Fields...), gen.Field{Name: "dwellings", Type: "int", Title: "Dwellings",
				Help: "Houses rebuilt as multi-storey dwellings with stairs and cellars", Min: 0, Max: 40, Step: 1, Default: world.DefaultDwellings})
			defs := map[string]any{"dwellings": world.DefaultDwellings}
			for k, v := range in.Defaults {
				defs[k] = v
			}
			in.Defaults = defs
		}
		out = append(out, in)
	}
	writeJSON(w, r, out)
}

func (s *server) generate(w http.ResponseWriter, r *http.Request) {
	tool := r.PathValue("tool")
	params, _ := io.ReadAll(r.Body)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	t0 := time.Now()
	m, id, err := s.b.Piece(ctx, tool, params)
	if err != nil {
		httpErr(w, err)
		return
	}
	d := terrain.Convert(m, s.pal, terrain.Options{})
	d.ID = id
	s.remember(id, m)
	log.Printf("generate %s %s in %v", tool, id, time.Since(t0).Round(time.Millisecond))
	writeJSON(w, r, d)
}

func (s *server) world(w http.ResponseWriter, r *http.Request) {
	var req world.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	t0 := time.Now()
	res, err := s.b.Build(ctx, req)
	if err != nil {
		httpErr(w, err)
		return
	}
	d := terrain.Convert(res.Map, s.pal, terrain.Options{SpawnMarkers: world.SpawnMarkers(res.Request)})
	body, _ := json.Marshal(res.Request)
	d.ID = world.Key("world", body)
	s.remember(d.ID, res.Map)
	log.Printf("world %s: %d pieces in %v", d.ID, len(res.Request.Pieces), time.Since(t0).Round(time.Millisecond))
	writeJSON(w, r, map[string]any{"request": res.Request, "sites": res.Sites, "doc": d})
}

func (s *server) semantic(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	m := s.maps[r.PathValue("id")]
	s.mu.Unlock()
	if m == nil {
		http.Error(w, "unknown map id (generate it again)", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.semantic.json"`, slug(m.Name)))
	writeJSON(w, r, m)
}

func (s *server) lab(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	d, err := terrain.Lab(s.pal, terrain.LabOptions{Mode: q.Get("mode"), A: q.Get("a"), B: q.Get("b"), Set: q.Get("set")})
	if err != nil {
		httpErr(w, err)
		return
	}
	writeJSON(w, r, d)
}

func (s *server) getTheme(w http.ResponseWriter, r *http.Request) {
	b, err := s.themes.Get(r.PathValue("name"))
	if err != nil {
		http.Error(w, "unknown theme", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

func (s *server) saveTheme(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	if err := s.themes.Save(r.PathValue("name"), body); err != nil {
		httpErr(w, err)
		return
	}
	writeJSON(w, r, s.themes.List())
}

func writeJSON(w http.ResponseWriter, r *http.Request, v any) {
	w.Header().Set("Content-Type", "application/json")
	var out io.Writer = w
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		out = gz
	}
	if err := json.NewEncoder(out).Encode(v); err != nil {
		log.Print(err)
	}
}

func httpErr(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "map"
	}
	return strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		return '-'
	}, s)
}

// genCmd writes a terrain doc to a file, for scripts and the Studio.
func genCmd(args []string) {
	fl := flag.NewFlagSet("gen", flag.ExitOnError)
	params := fl.String("p", "{}", "params JSON")
	outPath := fl.String("o", "", "output file (default stdout)")
	semOut := fl.String("semantic", "", "also write the semantic map here")
	if len(args) == 0 {
		var names []string
		for _, t := range gen.All() {
			names = append(names, t.Info().Name)
		}
		sort.Strings(names)
		fmt.Fprintf(os.Stderr, "usage: automix gen <%s|world> [-p json] [-o file]\n", strings.Join(names, "|"))
		os.Exit(2)
	}
	tool := args[0]
	fl.Parse(args[1:])
	b := world.NewBuilder(8)
	ctx := context.Background()
	var m *semantic.Map
	var d *terrain.Doc
	pal := terrain.Default()
	if tool == "world" {
		var req world.Request
		if err := json.Unmarshal([]byte(*params), &req); err != nil {
			log.Fatal(err)
		}
		res, err := b.Build(ctx, req)
		if err != nil {
			log.Fatal(err)
		}
		m = res.Map
		d = terrain.Convert(m, pal, terrain.Options{SpawnMarkers: world.SpawnMarkers(res.Request)})
	} else {
		var err error
		if m, _, err = b.Piece(ctx, tool, json.RawMessage(*params)); err != nil {
			log.Fatal(err)
		}
		d = terrain.Convert(m, pal, terrain.Options{})
	}
	write := func(path string, v any) {
		var out io.Writer = os.Stdout
		if path != "" {
			f, err := os.Create(path)
			if err != nil {
				log.Fatal(err)
			}
			defer f.Close()
			out = f
		}
		if err := json.NewEncoder(out).Encode(v); err != nil {
			log.Fatal(err)
		}
	}
	write(*outPath, d)
	if *semOut != "" {
		write(*semOut, m)
	}
	if len(d.Unmapped) > 0 {
		fmt.Fprintln(os.Stderr, "unmapped tags:", d.Unmapped)
	}
}
