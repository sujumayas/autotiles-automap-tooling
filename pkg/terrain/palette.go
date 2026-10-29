// Package terrain turns a tilegen semantic map into a terrain map: per cell a
// material id that one fragment shader draws (no tileset), plus procedural
// props, colliders and portals. It replaces tilegen's palette + bake step; the
// generators and their semantic maps stay as they are.
package terrain

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed default_palette.json
var defaultPalette []byte

// Material is one shader layer. Its index in Palette.Materials is its id and
// its stacking order: a higher id sits on top of every lower one.
type Material struct {
	Name    string   `json:"name"`
	Pattern string   `json:"pattern"`
	Soft    bool     `json:"soft,omitempty"`
	Solid   bool     `json:"solid,omitempty"`
	Height  float64  `json:"height,omitempty"`
	Noise   float64  `json:"noise,omitempty"`
	Param   float64  `json:"param,omitempty"`
	Colors  []string `json:"colors"`
	// Set groups materials into kits (nature, settlement, ship...) for the lab and editor.
	Set string `json:"set,omitempty"`
	// Accent is a fourth colour: foam, sparks, lights, specks. Empty = derived.
	Accent string `json:"accent,omitempty"`
	// Glow keeps the material lit in the dark (lava, glowing water).
	Glow bool `json:"glow,omitempty"`
	// Under forces the soft underlay of this material's cells (water under bridges).
	Under string `json:"under,omitempty"`
}

// Raised materials get a front face and cast a shadow.
func (m Material) Raised() bool { return m.Height > 0 }

// PropDef says how an item tag is drawn and whether it blocks.
type PropDef struct {
	Draw  string  `json:"draw,omitempty"`
	Color string  `json:"color,omitempty"`
	Solid string  `json:"solid,omitempty"` // "" | "cell" | "circle"
	R     float64 `json:"r,omitempty"`
	// Ground replaces the cell's material instead of drawing a prop (bridges, fences).
	Ground string `json:"ground,omitempty"`
	Skip   bool   `json:"skip,omitempty"`
}

// Palette maps semantic tags to materials and props.
type Palette struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Fallback    string `json:"fallback"`
	// UnderlayBelow is the underlay fallback below ground (default Fallback).
	UnderlayBelow string                                `json:"underlay_below,omitempty"`
	Void          struct{ Below, Ground, Above string } `json:"void"`
	Materials     []Material                            `json:"materials"`
	Ground        map[string]string                     `json:"ground"`
	Props         map[string]PropDef                    `json:"props"`

	index map[string]int
}

// Default returns the embedded palette.
func Default() *Palette {
	p, err := ParsePalette(defaultPalette)
	if err != nil {
		panic(err)
	}
	return p
}

// ParsePalette reads and checks a palette document.
func ParsePalette(b []byte) (*Palette, error) {
	var p Palette
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	if len(p.Materials) == 0 || len(p.Materials) > 255 {
		return nil, fmt.Errorf("palette: need 1..255 materials, got %d", len(p.Materials))
	}
	p.index = map[string]int{}
	for i, m := range p.Materials {
		if _, dup := p.index[m.Name]; dup {
			return nil, fmt.Errorf("palette: material %q listed twice", m.Name)
		}
		if len(m.Colors) != 3 {
			return nil, fmt.Errorf("palette: material %q needs 3 colors", m.Name)
		}
		p.index[m.Name] = i
	}
	check := func(where, name string) error {
		if _, ok := p.index[name]; !ok {
			return fmt.Errorf("palette: %s names unknown material %q", where, name)
		}
		return nil
	}
	for _, c := range [][2]string{{"fallback", p.Fallback}, {"void.below", p.Void.Below}, {"void.ground", p.Void.Ground}, {"void.above", p.Void.Above}} {
		if err := check(c[0], c[1]); err != nil {
			return nil, err
		}
	}
	if p.UnderlayBelow != "" {
		if err := check("underlay_below", p.UnderlayBelow); err != nil {
			return nil, err
		}
	}
	for _, m := range p.Materials {
		if m.Under != "" {
			if err := check("material "+m.Name+" under", m.Under); err != nil {
				return nil, err
			}
		}
	}
	for tag, name := range p.Ground {
		if err := check("ground "+tag, name); err != nil {
			return nil, err
		}
	}
	for tag, d := range p.Props {
		if d.Ground != "" {
			if err := check("prop "+tag, d.Ground); err != nil {
				return nil, err
			}
		}
	}
	return &p, nil
}

// ID of a material by name (-1 if missing).
func (p *Palette) ID(name string) int {
	if i, ok := p.index[name]; ok {
		return i
	}
	return -1
}

// groundID resolves a ground tag along its path (a/b/c → a/b → a).
func (p *Palette) groundID(tag string) (int, bool) {
	for t := tag; t != ""; t = parent(t) {
		if name, ok := p.Ground[t]; ok {
			return p.index[name], true
		}
	}
	return p.index[p.Fallback], false
}

// prop resolves an item tag along its path and returns the matched key.
func (p *Palette) prop(tag string) (string, PropDef, bool) {
	for t := tag; t != ""; t = parent(t) {
		if d, ok := p.Props[t]; ok {
			return t, d, true
		}
	}
	return "", PropDef{}, false
}

func parent(t string) string {
	if i := strings.LastIndexByte(t, '/'); i >= 0 {
		return t[:i]
	}
	return ""
}
