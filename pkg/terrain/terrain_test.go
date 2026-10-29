package terrain_test

import (
	"context"
	"encoding/json"
	"testing"

	"automix/pkg/terrain"
	"automix/pkg/world"
)

// Every generator's output must be fully mapped and walkable: the spawn is
// open, and every floor can be reached from it on foot plus portals.
func TestPlayable(t *testing.T) {
	cases := []struct{ tool, params string }{
		{"realm", `{"width":256,"height":256,"seed":3}`},
		{"city", `{"seed":7}`},
		{"city", `{"seed":7,"tags":["coast","river"]}`},
		{"city", `{"seed":11,"size":24,"dwellings":12}`},
		{"village", `{"seed":3}`},
		{"cave", `{"seed":3,"levels":2}`},
		{"cave", `{"seed":3,"glade":true}`},
		{"dungeon", `{"seed":3,"levels":2}`},
		{"dwelling", `{"seed":5,"floors":2,"basement":true}`},
	}
	b := world.NewBuilder(16)
	pal := terrain.Default()
	for _, c := range cases {
		m, _, err := b.Piece(context.Background(), c.tool, json.RawMessage(c.params))
		if err != nil {
			t.Fatalf("%s %s: %v", c.tool, c.params, err)
		}
		checkDoc(t, c.tool+" "+c.params, terrain.Convert(m, pal, terrain.Options{}), pal)
	}
}

func TestWorld(t *testing.T) {
	b := world.NewBuilder(16)
	req := world.Request{Surface: json.RawMessage(`{"seed":3,"width":384,"height":384,"dangers":4}`), Autofill: true}
	res, err := b.Build(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Request.Pieces) == 0 {
		t.Fatal("autofill placed no pieces")
	}
	d := terrain.Convert(res.Map, terrain.Default(), terrain.Options{SpawnMarkers: world.SpawnMarkers(res.Request)})
	checkDoc(t, "world", d, terrain.Default())
}

func checkDoc(t *testing.T, name string, d *terrain.Doc, pal *terrain.Palette) {
	t.Helper()
	if len(d.Unmapped) > 0 {
		t.Errorf("%s: unmapped tags %v", name, d.Unmapped)
	}
	solid := map[int][]bool{}
	for _, f := range d.Floors {
		s := make([]bool, d.W*d.H)
		for i := range s {
			s[i] = pal.Materials[f.Cells[i*4]].Solid
		}
		for i := 0; i < len(f.Props); i += 4 {
			if d.PropKinds[f.Props[i]].Solid == "cell" {
				s[int(f.Props[i+2])*d.W+int(f.Props[i+1])] = true
			}
		}
		for _, i := range f.Blocked {
			s[i] = true
		}
		for _, i := range f.Open {
			s[i] = false
		}
		solid[f.DZ] = s
	}
	at := func(p terrain.Point) int { return p.Y*d.W + p.X }
	if solid[d.Spawn.DZ][at(d.Spawn)] {
		t.Errorf("%s: spawn %v is solid", name, d.Spawn)
	}
	out := map[terrain.Point][]terrain.Point{}
	for _, p := range d.Portals {
		out[p.From] = append(out[p.From], p.To)
	}
	seen := map[terrain.Point]bool{d.Spawn: true}
	queue := []terrain.Point{d.Spawn}
	reached := map[int]bool{}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		reached[p.DZ] = true
		next := out[p]
		for _, dd := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
			q := terrain.Point{X: p.X + dd[0], Y: p.Y + dd[1], DZ: p.DZ}
			if q.X >= 0 && q.Y >= 0 && q.X < d.W && q.Y < d.H && !solid[q.DZ][at(q)] {
				next = append(next, q)
			}
		}
		for _, q := range next {
			if !seen[q] {
				seen[q] = true
				queue = append(queue, q)
			}
		}
	}
	for _, p := range d.Portals {
		if !seen[p.From] {
			t.Errorf("%s: portal %s at %v not reachable from spawn %v", name, p.Name, p.From, d.Spawn)
		}
	}
	for _, f := range d.Floors {
		if !reached[f.DZ] {
			t.Errorf("%s: floor dz=%d not reachable from spawn %v", name, f.DZ, d.Spawn)
		}
	}
}
