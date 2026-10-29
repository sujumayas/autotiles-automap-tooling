package terrain

import (
	"fmt"
	"sort"

	"tilegen/pkg/semantic"
)

// LabOptions pick what the edge lab shows.
type LabOptions struct {
	// Mode is "matrix" (every pair), "one" (A against every other) or "pair"
	// (the full edge-case board for A and B).
	Mode string `json:"mode"`
	A    string `json:"a"`
	B    string `json:"b"`
	// Set limits the materials to one kit ("" = all).
	Set string `json:"set"`
}

const (
	patch = 8         // patch side in tiles
	step  = patch + 1 // patch plus its frame
)

// A patch of base material with the other one in small shapes: a lone tile,
// a 2×2 block, a one-tile line, a diagonal and an L with an inner corner.
var patchShape = [][2]int{
	{1, 1},
	{3, 1}, {4, 1}, {3, 2}, {4, 2},
	{6, 1}, {6, 2}, {6, 3},
	{1, 4}, {2, 5}, {3, 6},
	{5, 5}, {6, 5}, {7, 5}, {5, 6}, {6, 6}, {5, 7},
}

type lab struct {
	p      *Palette
	w, h   int
	ids    []int
	d      *Doc
	props  []int32
	kinds  map[string]int
	frame  int
	labels []semantic.Label
}

// Lab builds a test map of material edges. It is a normal terrain doc, so the
// viewer walks it and themes recolour it like any other map.
func Lab(p *Palette, o LabOptions) (*Doc, error) {
	var mats []int
	for i, m := range p.Materials {
		if m.Name == p.Void.Above || o.Set != "" && m.Set != o.Set {
			continue
		}
		mats = append(mats, i)
	}
	a, b := p.ID(o.A), p.ID(o.B)
	switch o.Mode {
	case "", "matrix":
		if len(mats) == 0 {
			return nil, fmt.Errorf("lab: no materials in set %q", o.Set)
		}
		return labMatrix(p, mats), nil
	case "one":
		if a < 0 {
			return nil, fmt.Errorf("lab: unknown material %q", o.A)
		}
		return labOne(p, a, mats), nil
	case "pair":
		if a < 0 || b < 0 {
			return nil, fmt.Errorf("lab: unknown materials %q, %q", o.A, o.B)
		}
		return labPair(p, a, b), nil
	}
	return nil, fmt.Errorf("lab: unknown mode %q", o.Mode)
}

func newLab(p *Palette, w, h int, name string) *lab {
	l := &lab{p: p, w: w, h: h, ids: make([]int, w*h), kinds: map[string]int{}, frame: p.ID(p.Void.Above), props: []int32{}}
	for i := range l.ids {
		l.ids[i] = l.frame
	}
	l.d = &Doc{Kind: Kind, Version: 1, Tool: "lab", Name: name, W: w, H: h, Materials: p.Materials,
		PropKinds: []PropKind{}, Portals: []Portal{}, Markers: []semantic.Marker{}, Zones: []Zone{}, Unmapped: map[string]int{}}
	return l
}

func (l *lab) set(x, y, id int) {
	if x >= 0 && y >= 0 && x < l.w && y < l.h {
		l.ids[y*l.w+x] = id
	}
}

func (l *lab) fill(x, y, w, h, id int) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			l.set(i, j, id)
		}
	}
}

func (l *lab) name(id int) string { return l.p.Materials[id].Name }

// patch draws base with other in patchShape at (x, y), labelled on the frame above.
func (l *lab) patch(x, y, base, other int) {
	l.fill(x, y, patch, patch, base)
	title := l.name(base)
	if other != base {
		for _, c := range patchShape {
			l.set(x+c[0], y+c[1], other)
		}
		title = l.name(other) + " in " + l.name(base)
	}
	l.labels = append(l.labels, semantic.Label{Text: title, X: float64(x) + patch/2, Y: float64(y) - 0.25, Kind: "district"})
	l.d.Zones = append(l.d.Zones, Zone{Kind: "pair", Name: title, Rect: semantic.Rect{X: x, Y: y, W: patch, H: patch}})
}

// propStrips lays every prop kind of the palette on two strips: nature on
// grass, everything else on stone floor.
func (l *lab) propStrips(y int) {
	nature := map[string]bool{"tree": true, "pine": true, "bare": true, "bush": true, "rock": true, "stalagmite": true, "crystal": true,
		"mushrooms": true, "reeds": true, "fern": true, "flowers": true, "lily": true, "pebbles": true, "stump": true, "log": true}
	var keys []string
	for k, d := range l.p.Props {
		if !d.Skip && d.Ground == "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	seen := map[string]bool{}
	var wild, built []string
	for _, k := range keys {
		d := l.p.Props[k]
		if d.Draw == "" {
			d.Draw = "box"
		}
		v := d.Draw + "|" + d.Color
		if seen[v] {
			continue
		}
		seen[v] = true
		if nature[d.Draw] {
			wild = append(wild, k)
		} else {
			built = append(built, k)
		}
	}
	row := func(y int, list []string, ground string) int {
		per := (l.w - 2) / 2
		rows := (len(list) + per - 1) / per
		l.fill(1, y, l.w-2, rows*2+1, l.p.ID(ground))
		for i, k := range list {
			l.addProp(k, 2+(i%per)*2, y+1+(i/per)*2)
		}
		l.labels = append(l.labels, semantic.Label{Text: "props on " + ground, X: float64(l.w) / 2, Y: float64(y) - 0.25, Kind: "district"})
		return y + rows*2 + 2
	}
	y = row(y, wild, "grass")
	row(y, built, "stonefloor")
}

// propRows is how many tile rows propStrips needs for a map w wide.
func propRows(p *Palette, w int) int {
	n := len(p.Props)
	per := (w - 2) / 2
	return 2*((n+per-1)/per) + 8
}

func (l *lab) addProp(key string, x, y int) {
	d := l.p.Props[key]
	k, ok := l.kinds[key]
	if !ok {
		draw := d.Draw
		if draw == "" {
			draw = "box"
		}
		k = len(l.d.PropKinds)
		l.kinds[key] = k
		l.d.PropKinds = append(l.d.PropKinds, PropKind{Key: key, Draw: draw, Color: d.Color, Solid: d.Solid, R: d.R})
	}
	l.props = append(l.props, int32(k), int32(x), int32(y), int32(hash(x, y, 0, 1)&0xff))
}

func (l *lab) finish(spawn Point) *Doc {
	cells := bakeCells(l.ids, l.w, l.h, 0, l.p)
	// Frame cells take the underlay of the nearest patch cell, so a frame never
	// reads as a shore or a different ground to the patch it borders.
	queue := []int{}
	done := make([]bool, l.w*l.h)
	for i, id := range l.ids {
		if id != l.frame {
			done[i] = true
			queue = append(queue, i)
		}
	}
	for q := 0; q < len(queue); q++ {
		i := queue[q]
		x, y := i%l.w, i/l.w
		for _, dd := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			nx, ny := x+dd[0], y+dd[1]
			if nx < 0 || ny < 0 || nx >= l.w || ny >= l.h || done[ny*l.w+nx] {
				continue
			}
			j := ny*l.w + nx
			done[j] = true
			cells[j*4+1] = cells[i*4+1]
			queue = append(queue, j)
		}
	}
	l.d.Floors = []*Floor{{DZ: 0, Cells: cells, Props: l.props}}
	l.d.Labels = l.labels
	l.d.Spawn = spawn
	return l.d
}

func labMatrix(p *Palette, mats []int) *Doc {
	n := len(mats)
	w := 1 + n*step
	h := 1 + n*step + propRows(p, w)
	l := newLab(p, w, h, fmt.Sprintf("Edge lab: %d×%d pairs", n, n))
	for r, base := range mats {
		for c, other := range mats {
			l.patch(1+c*step, 1+r*step, base, other)
		}
	}
	l.propStrips(1 + n*step + 1)
	return l.finish(Point{X: 1 + patch/2, Y: 1 + patch/2})
}

func labOne(p *Palette, a int, mats []int) *Doc {
	const cols = 8
	var others []int
	for _, m := range mats {
		if m != a {
			others = append(others, m)
		}
	}
	rows := (len(others)*2 + cols - 1) / cols
	w, h := 1+cols*step, 1+rows*step
	l := newLab(p, w, h, "Edge lab: "+p.Materials[a].Name+" against all")
	for i, o := range others {
		k := i * 2
		l.patch(1+(k%cols)*step, 1+(k/cols)*step, a, o)
		k++
		l.patch(1+(k%cols)*step, 1+(k/cols)*step, o, a)
	}
	return l.finish(Point{X: 1 + patch/2, Y: 1 + patch/2})
}

// labPair is the hand-made board of auto-tiles' edge lab, generated: lone
// tiles, a saddle, a checkerboard, one-tile lines, a diagonal, a staircase, a
// four-way corner, inner corners and a disc. The left half has B features in
// A, the right half the same features with the roles swapped.
func labPair(p *Palette, a, b int) *Doc {
	const half = 24
	w, h := 1+half*2+1, 26
	l := newLab(p, w, h, fmt.Sprintf("Edge lab: %s / %s", p.Materials[a].Name, p.Materials[b].Name))
	board := func(ox, base, fg int) {
		l.fill(ox, 1, half-1, h-2, base)
		s := func(x, y int) { l.set(ox+x, 1+y, fg) }
		s(2, 2)
		s(5, 2)
		s(8, 2) // saddle
		s(9, 3)
		for y := 0; y < 5; y++ { // checkerboard
			for x := 0; x < 5; x++ {
				if (x+y)%2 == 0 {
					s(12+x, 2+y)
				}
			}
		}
		for x := 2; x <= 9; x++ { // horizontal line
			s(x, 9)
		}
		for y := 6; y <= 13; y++ { // vertical line
			s(19, y)
		}
		for k := 0; k < 6; k++ { // diagonal
			s(11+k, 9+k)
		}
		for k := 0; k < 5; k++ { // staircase
			s(2+k, 12+k)
			s(3+k, 12+k)
		}
		for y := 0; y < 2; y++ { // four-way corner: two 2×2 blocks touching at a point
			for x := 0; x < 2; x++ {
				s(10+x, 17+y)
				s(12+x, 19+y)
			}
		}
		for y := 16; y <= 22; y++ { // L with inner corners
			for x := 16; x <= 21; x++ {
				if x < 18 || y > 20 {
					s(x, y)
				}
			}
		}
		for y := -3; y <= 3; y++ { // disc
			for x := -3; x <= 3; x++ {
				if x*x+y*y <= 10 {
					s(5+x, 20+y)
				}
			}
		}
		title := p.Materials[fg].Name + " in " + p.Materials[base].Name
		l.labels = append(l.labels, semantic.Label{Text: title, X: float64(ox) + half/2, Y: 0.75, Kind: "title"})
		l.d.Zones = append(l.d.Zones, Zone{Kind: "pair", Name: title, Rect: semantic.Rect{X: ox, Y: 1, W: half - 1, H: h - 2}})
	}
	board(1, a, b)
	board(1+half, b, a)
	return l.finish(Point{X: 11, Y: 12})
}
