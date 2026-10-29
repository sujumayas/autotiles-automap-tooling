package terrain

import (
	"sort"

	"tilegen/pkg/semantic"
)

// Kind is the document kind written in JSON.
const Kind = "terrain-map"

// Doc is everything the renderer and the walker need. It is self-contained:
// the materials and prop kinds it uses travel with it.
type Doc struct {
	Kind      string            `json:"kind"`
	Version   int               `json:"version"`
	ID        string            `json:"id,omitempty"`
	Tool      string            `json:"tool"`
	Name      string            `json:"name"`
	Seed      int64             `json:"seed"`
	W         int               `json:"w"`
	H         int               `json:"h"`
	Materials []Material        `json:"materials"`
	PropKinds []PropKind        `json:"prop_kinds"`
	Floors    []*Floor          `json:"floors"`
	Portals   []Portal          `json:"portals"`
	Markers   []semantic.Marker `json:"markers"`
	Labels    []semantic.Label  `json:"labels"`
	Zones     []Zone            `json:"zones"`
	Spawn     Point             `json:"spawn"`
	Unmapped  map[string]int    `json:"unmapped"`
	Meta      map[string]any    `json:"meta,omitempty"`
}

// Floor is one z-level. Cells holds 4 bytes per cell, row-major:
//
//	R  material id (what is drawn in this cell)
//	G  soft underlay: the soft material that crisp cells count as when soft
//	   layers blend around them, so a house does not grow a ring of plaza
//	B  1 if the material is raised (casts a shadow), else 0
//	A  per-cell variation hash
//
// Props is a flat list of quads: prop kind, x, y, variant.
type Floor struct {
	DZ      int     `json:"dz"`
	Cells   []byte  `json:"cells"`
	Props   []int32 `json:"props"`
	Blocked []int   `json:"blocked,omitempty"` // forced solid cells
	Open    []int   `json:"open,omitempty"`    // forced walkable cells
}

// PropKind is one entry of the prop table the floors index into.
type PropKind struct {
	Key   string  `json:"key"`
	Draw  string  `json:"draw"`
	Color string  `json:"color,omitempty"`
	Solid string  `json:"solid,omitempty"`
	R     float64 `json:"r,omitempty"`
}

// Point is a cell on a floor.
type Point struct {
	X  int `json:"x"`
	Y  int `json:"y"`
	DZ int `json:"dz"`
}

// Portal moves the walker from one cell to another: stairs, holes, cave mouths.
type Portal struct {
	From Point  `json:"from"`
	To   Point  `json:"to"`
	Name string `json:"name"`
	Kind string `json:"kind,omitempty"`
}

// Zone is a named region without its cell list.
type Zone struct {
	Kind string        `json:"kind"`
	Name string        `json:"name,omitempty"`
	DZ   int           `json:"dz"`
	Rect semantic.Rect `json:"rect"`
	Tags []string      `json:"tags,omitempty"`
}

// Options tune a conversion.
type Options struct {
	// SpawnMarkers are tried in order; the first that exists is the spawn.
	SpawnMarkers []string
}

// Convert builds the terrain doc of a semantic map.
func Convert(m *semantic.Map, p *Palette, o Options) *Doc {
	d := &Doc{
		Kind: Kind, Version: 1, Tool: m.Tool, Name: m.Name, Seed: m.Seed, W: m.W, H: m.H,
		Materials: p.Materials, PropKinds: []PropKind{}, Portals: []Portal{},
		Markers: m.Markers, Labels: m.Labels, Zones: []Zone{}, Unmapped: map[string]int{},
	}
	if d.Markers == nil {
		d.Markers = []semantic.Marker{}
	}
	if d.Labels == nil {
		d.Labels = []semantic.Label{}
	}
	kinds := map[string]int{}
	kindOf := func(key string, def PropDef) int {
		if k, ok := kinds[key]; ok {
			return k
		}
		if def.Draw == "" {
			def.Draw = "box"
		}
		kinds[key] = len(d.PropKinds)
		d.PropKinds = append(d.PropKinds, PropKind{Key: key, Draw: def.Draw, Color: def.Color, Solid: def.Solid, R: def.R})
		return kinds[key]
	}

	floors := append([]*semantic.Floor(nil), m.Floors...)
	sort.Slice(floors, func(i, j int) bool { return floors[i].DZ < floors[j].DZ })
	solidAt := map[int][]bool{}
	for _, f := range floors {
		out, solid := convertFloor(f, p, d, kindOf)
		d.Floors = append(d.Floors, out)
		solidAt[f.DZ] = solid
	}

	byName := map[string]semantic.Marker{}
	for _, mk := range m.Markers {
		byName[mk.Name] = mk
	}
	pt := func(mk semantic.Marker) Point { return Point{mk.X, mk.Y, mk.DZ} }
	for _, l := range m.Links {
		a, okA := byName[l.From]
		b, okB := byName[l.To]
		if !okA || !okB {
			continue
		}
		d.Portals = append(d.Portals, Portal{From: pt(a), To: pt(b), Name: l.From, Kind: l.Kind})
		if !l.OneWay {
			d.Portals = append(d.Portals, Portal{From: pt(b), To: pt(a), Name: l.To, Kind: l.Kind})
		}
	}

	for _, z := range m.Zones {
		d.Zones = append(d.Zones, Zone{Kind: z.Kind, Name: z.Name, DZ: z.DZ, Rect: z.Rect, Tags: z.Tags})
	}

	names := append(o.SpawnMarkers, "spawn", "entry")
	start := Point{m.W / 2, m.H / 2, 0}
	for _, n := range names {
		if mk, ok := byName[n]; ok {
			start = pt(mk)
			break
		}
	}
	d.Spawn = nearestOpen(start, m.W, m.H, solidAt[start.DZ])

	d.Meta = map[string]any{}
	for _, k := range []string{"pieces", "title", "story", "population"} {
		if v, ok := m.Meta[k]; ok {
			d.Meta[k] = v
		}
	}
	return d
}

func convertFloor(f *semantic.Floor, p *Palette, d *Doc, kindOf func(string, PropDef) int) (*Floor, []bool) {
	n := f.W * f.H
	out := &Floor{DZ: f.DZ, Props: []int32{}}
	void := p.ID(p.Void.Ground)
	if f.DZ < 0 {
		void = p.ID(p.Void.Below)
	} else if f.DZ > 0 {
		void = p.ID(p.Void.Above)
	}
	ids := make([]int, n)
	propSolid := make([]bool, n)
	for i := range f.Cells {
		c := &f.Cells[i]
		x, y := i%f.W, i/f.W
		id := void
		if c.Ground != "" {
			var ok bool
			if id, ok = p.groundID(c.Ground); !ok {
				d.Unmapped[c.Ground]++
			}
		}
		for j, it := range c.Items {
			key, def, ok := p.prop(it)
			if !ok {
				d.Unmapped["item:"+it]++
				key = it
			}
			if def.Skip {
				continue
			}
			if def.Ground != "" {
				id = p.ID(def.Ground)
				continue
			}
			k := kindOf(key, def)
			if def.Solid != "" {
				propSolid[i] = true
			}
			out.Props = append(out.Props, int32(k), int32(x), int32(y), int32(hash(x, y, f.DZ, j)&0xff))
		}
		ids[i] = id
	}

	out.Cells = bakeCells(ids, f.W, f.H, f.DZ, p)
	solid := make([]bool, n)
	for i, id := range ids {
		mat := p.Materials[id]
		solid[i] = mat.Solid || propSolid[i]
		if b := f.Cells[i].Blocked; b != nil {
			if *b && !solid[i] {
				out.Blocked = append(out.Blocked, i)
			} else if !*b && mat.Solid {
				out.Open = append(out.Open, i)
			}
			solid[i] = *b
		}
	}
	return out, solid
}

// bakeCells packs material ids into the 4-byte cells the shader reads.
func bakeCells(ids []int, w, h, dz int, p *Palette) []byte {
	n := w * h
	// Soft underlay: crisp cells take the nearest walkable soft material, found
	// by a multi-source BFS. Solid soft materials (water, cliffs, bedrock) never
	// seed, or they would show through wherever a neighbour's noisy edge
	// recedes. A material can force its underlay instead (water under bridges).
	under := make([]int, n)
	fallback := p.ID(p.Fallback)
	if dz < 0 && p.UnderlayBelow != "" {
		fallback = p.ID(p.UnderlayBelow)
	}
	queue := make([]int, 0, n)
	for i, id := range ids {
		under[i] = -1
		mat := p.Materials[id]
		switch {
		case mat.Under != "":
			under[i] = p.ID(mat.Under)
		case mat.Soft && !mat.Solid:
			under[i] = id
			queue = append(queue, i)
		case mat.Soft:
			under[i] = id
		}
	}
	for q := 0; q < len(queue); q++ {
		i := queue[q]
		x, y := i%w, i/w
		for _, dd := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+dd[0], y+dd[1]
			if nx < 0 || ny < 0 || nx >= w || ny >= h {
				continue
			}
			j := ny*w + nx
			if under[j] == -1 {
				under[j] = under[i]
				queue = append(queue, j)
			}
		}
	}
	cells := make([]byte, n*4)
	for i, id := range ids {
		g := under[i]
		if g < 0 {
			g = fallback
		}
		raised := byte(0)
		if p.Materials[id].Raised() {
			raised = 1
		}
		cells[i*4] = byte(id)
		cells[i*4+1] = byte(g)
		cells[i*4+2] = raised
		cells[i*4+3] = byte(hash(i%w, i/w, dz, 99))
	}
	return cells
}

// nearestOpen walks out from start to the closest cell that is not solid.
func nearestOpen(start Point, w, h int, solid []bool) Point {
	if solid == nil {
		return start
	}
	in := func(x, y int) bool { return x >= 0 && y >= 0 && x < w && y < h }
	if !in(start.X, start.Y) {
		start.X, start.Y = w/2, h/2
	}
	seen := make([]bool, w*h)
	queue := []int{start.Y*w + start.X}
	seen[queue[0]] = true
	for q := 0; q < len(queue); q++ {
		i := queue[q]
		if !solid[i] {
			return Point{i % w, i / w, start.DZ}
		}
		x, y := i%w, i/w
		for _, dd := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+dd[0], y+dd[1]
			if in(nx, ny) && !seen[ny*w+nx] {
				seen[ny*w+nx] = true
				queue = append(queue, ny*w+nx)
			}
		}
	}
	return start
}

func hash(x, y, z, k int) uint32 {
	h := uint32(x)*374761393 + uint32(y)*668265263 + uint32(z+64)*2246822519 + uint32(k)*3266489917
	h = (h ^ (h >> 13)) * 1274126177
	return h ^ (h >> 16)
}
