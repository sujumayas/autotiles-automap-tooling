// Package world builds a whole playable world: a realm surface whose proposed
// sites are filled with the matching generator (city, village, cave, dungeon),
// composed with tilegen's compose package. Generated maps are cached by
// tool + params, so editing one piece does not regenerate the others.
package world

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"strings"
	"sync"

	"tilegen/pkg/compose"
	"tilegen/pkg/gen"
	_ "tilegen/pkg/gen/all"
	"tilegen/pkg/semantic"
)

// Request is a world document. The client keeps it and sends it back whole.
type Request struct {
	Name    string           `json:"name"`
	Surface json.RawMessage  `json:"surface"` // realm params
	Pieces  []*compose.Piece `json:"pieces"`
	// Autofill fills every site that has no piece and is not in Skip.
	Autofill bool     `json:"autofill"`
	Skip     []string `json:"skip,omitempty"`
}

// Site is a proposed location on the surface and what fills it.
type Site struct {
	Slug  string        `json:"slug"`
	Name  string        `json:"name"`
	Kind  string        `json:"kind"`
	Rect  semantic.Rect `json:"rect"`
	Piece string        `json:"piece,omitempty"`
}

// Result is the composed world plus the request as it now stands.
type Result struct {
	Request Request       `json:"request"`
	Sites   []Site        `json:"sites"`
	Map     *semantic.Map `json:"-"`
}

// SiteTool picks the generator for a site kind and footprint ("" = none).
func SiteTool(kind string, r semantic.Rect) string {
	switch kind {
	case "city", "town":
		if r.W >= 64 && r.H >= 64 {
			return "city"
		}
		return "village"
	case "village":
		return "village"
	case "cave":
		return "cave"
	case "dungeon":
		return "dungeon"
	}
	return ""
}

// SiteParams are the default params for a piece filling a site.
func SiteParams(tool, kind string, s semantic.Zone, worldSeed int64) json.RawMessage {
	p := map[string]any{"seed": seedFor(worldSeed, s.Name, tool), "width": s.Rect.W, "height": s.Rect.H}
	if s.Name != "" {
		p["name"] = s.Name
	}
	if tool == "city" && kind == "town" {
		p["tags"] = []string{"small"}
	}
	b, _ := json.Marshal(p)
	return b
}

func seedFor(worldSeed int64, name, tool string) int64 {
	h := fnv.New32a()
	fmt.Fprintf(h, "%d/%s/%s", worldSeed, name, tool)
	return int64(h.Sum32() % 1000000)
}

// Slug identifies a site across regenerations.
func Slug(z semantic.Zone) string {
	if z.Name != "" {
		return strings.ToLower(strings.ReplaceAll(z.Name, " ", "-"))
	}
	return fmt.Sprintf("site_%d_%d", z.Rect.X, z.Rect.Y)
}

func siteKind(z semantic.Zone) string {
	for _, t := range z.Tags {
		switch t {
		case "city", "town", "village", "cave", "dungeon":
			return t
		}
	}
	if len(z.Tags) > 0 {
		return z.Tags[0]
	}
	return ""
}

// Builder generates and caches maps.
type Builder struct {
	mu    sync.Mutex
	cache map[string]*semantic.Map
	order []string
	Max   int
}

// NewBuilder makes a builder that keeps up to max maps.
func NewBuilder(max int) *Builder { return &Builder{cache: map[string]*semantic.Map{}, Max: max} }

// Key is the cache key of a generation.
func Key(tool string, params json.RawMessage) string {
	var v any
	_ = json.Unmarshal(params, &v)
	canon, _ := json.Marshal(v) // map keys come out sorted
	h := sha1.Sum(append([]byte(tool+"\x00"), canon...))
	return hex.EncodeToString(h[:8])
}

// Generate runs a tool, or returns the cached map. Callers must not modify it.
func (b *Builder) Generate(ctx context.Context, tool string, params json.RawMessage) (*semantic.Map, string, error) {
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	key := Key(tool, params)
	if m := b.cached(key); m != nil {
		return m, key, nil
	}
	t, ok := gen.Lookup(tool)
	if !ok {
		return nil, "", fmt.Errorf("unknown tool %q", tool)
	}
	m, err := gen.Run(ctx, t, params)
	if err != nil {
		return nil, "", err
	}
	b.store(key, m)
	return m, key, nil
}

func (b *Builder) cached(key string) *semantic.Map {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cache[key]
}

func (b *Builder) store(key string, m *semantic.Map) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.cache[key]; ok {
		return
	}
	b.cache[key] = m
	b.order = append(b.order, key)
	for len(b.order) > b.Max {
		delete(b.cache, b.order[0])
		b.order = b.order[1:]
	}
}

// Build composes the world a request describes.
func (b *Builder) Build(ctx context.Context, req Request) (*Result, error) {
	if len(req.Surface) == 0 {
		req.Surface = json.RawMessage(`{}`)
	}
	surf, _, err := b.Generate(ctx, "realm", req.Surface)
	if err != nil {
		return nil, fmt.Errorf("surface: %w", err)
	}
	if req.Name == "" {
		req.Name = surf.Name
	}
	pr := &compose.Project{Name: req.Name, Surface: &compose.Piece{ID: "surface", Tool: "realm", Params: req.Surface, Map: surf}}

	skip := map[string]bool{}
	for _, s := range req.Skip {
		skip[s] = true
	}
	used := map[string]string{}
	for _, pc := range req.Pieces {
		if pc.Site != "" {
			used[pc.Site] = pc.ID
		}
	}
	var sites []Site
	for _, z := range pr.Sites() {
		kind := siteKind(z)
		tool := SiteTool(kind, z.Rect)
		if tool == "" {
			continue
		}
		slug := Slug(z)
		if req.Autofill && used[slug] == "" && !skip[slug] {
			pc := &compose.Piece{ID: pr.NewPieceID(tool), Tool: tool, Params: SiteParams(tool, kind, z, surf.Seed), X: z.Rect.X, Y: z.Rect.Y, Site: slug}
			pr.Pieces = append(pr.Pieces, pc) // reserves the id for NewPieceID
			req.Pieces = append(req.Pieces, pc)
			used[slug] = pc.ID
		}
		sites = append(sites, Site{Slug: slug, Name: z.Name, Kind: kind, Rect: z.Rect, Piece: used[slug]})
	}
	req.Autofill = false

	pr.Pieces = nil
	for _, pc := range req.Pieces {
		m, _, err := b.Piece(ctx, pc.Tool, pc.Params)
		if err != nil {
			return nil, fmt.Errorf("piece %s: %w", pc.ID, err)
		}
		pr.Pieces = append(pr.Pieces, &compose.Piece{ID: pc.ID, Tool: pc.Tool, Params: pc.Params, X: pc.X, Y: pc.Y, Site: pc.Site, Map: m})
	}
	w, err := pr.Compose(ctx)
	if err != nil {
		return nil, err
	}
	return &Result{Request: req, Sites: sites, Map: w}, nil
}

// SpawnMarkers prefers the plaza of the first settlement, then the surface spawn.
func SpawnMarkers(req Request) []string {
	var out []string
	for _, pc := range req.Pieces {
		if pc.Tool == "city" || pc.Tool == "village" {
			out = append(out, pc.ID+"/spawn")
		}
	}
	return out
}
