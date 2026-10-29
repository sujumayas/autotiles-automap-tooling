package terrain

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

//go:embed themes/*.json
var builtinThemes embed.FS

// Theme is a visual skin over a palette: per material colours, pattern,
// accent and glow, and prop swaps. It never changes what is solid or how tags
// map, so one generated map can be shown in any theme. The renderer applies
// it; the server only stores it.
type Theme struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	// Materials override by material name: pattern, colors, accent, glow, noise, param.
	Materials map[string]json.RawMessage `json:"materials"`
	// Props override drawers by draw name or prop key: {"draw": "...", "color": "..."}.
	Props map[string]json.RawMessage `json:"props,omitempty"`
	// PropFilter is a CSS filter baked into every prop sprite.
	PropFilter string `json:"prop_filter,omitempty"`
	// SurfaceLight > 0 makes the surface dark with a light of that radius.
	SurfaceLight float64 `json:"surface_light,omitempty"`
}

// ThemeInfo is a row of the theme list.
type ThemeInfo struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Builtin     bool   `json:"builtin"`
	Saved       bool   `json:"saved"`
}

var themeName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,40}$`)

// Themes stores user themes in Dir over the built-in ones.
type Themes struct{ Dir string }

func (t Themes) path(name string) string { return filepath.Join(t.Dir, name+".json") }

// List returns built-in and saved themes, default first.
func (t Themes) List() []ThemeInfo {
	byName := map[string]*ThemeInfo{}
	add := func(b []byte, builtin bool) {
		var th Theme
		if json.Unmarshal(b, &th) != nil || !themeName.MatchString(th.Name) {
			return
		}
		in := byName[th.Name]
		if in == nil {
			in = &ThemeInfo{Name: th.Name}
			byName[th.Name] = in
		}
		in.Title, in.Description = th.Title, th.Description
		in.Builtin = in.Builtin || builtin
		in.Saved = in.Saved || !builtin
	}
	files, _ := builtinThemes.ReadDir("themes")
	for _, f := range files {
		b, _ := builtinThemes.ReadFile("themes/" + f.Name())
		add(b, true)
	}
	if files, err := os.ReadDir(t.Dir); err == nil {
		for _, f := range files {
			if strings.HasSuffix(f.Name(), ".json") {
				b, _ := os.ReadFile(filepath.Join(t.Dir, f.Name()))
				add(b, false)
			}
		}
	}
	var out []ThemeInfo
	for _, in := range byName {
		out = append(out, *in)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Name == "default") != (out[j].Name == "default") {
			return out[i].Name == "default"
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// Get returns a theme document, the saved copy first.
func (t Themes) Get(name string) ([]byte, error) {
	if !themeName.MatchString(name) {
		return nil, fmt.Errorf("bad theme name %q", name)
	}
	if b, err := os.ReadFile(t.path(name)); err == nil {
		return b, nil
	}
	return builtinThemes.ReadFile("themes/" + name + ".json")
}

// Save writes a theme to Dir under its name.
func (t Themes) Save(name string, body []byte) error {
	if !themeName.MatchString(name) {
		return fmt.Errorf("theme names are lower-case letters, digits and dashes")
	}
	var th Theme
	if err := json.Unmarshal(body, &th); err != nil {
		return err
	}
	th.Name = name
	if th.Title == "" {
		th.Title = name
	}
	out, _ := json.MarshalIndent(th, "", "  ")
	if err := os.MkdirAll(t.Dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(t.path(name), append(out, '\n'), 0o644)
}
