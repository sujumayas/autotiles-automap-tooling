package world

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"tilegen/pkg/semantic"
)

// DefaultDwellings is how many city houses become multi-storey dwellings when
// the city params do not say ("dwellings": n, which the city tool ignores).
const DefaultDwellings = 6

// Smallest building the dwelling generator can fill (its minimum footprint).
const minDwellW, minDwellH = 7, 6

// Piece generates a piece. Cities get dwellings swapped into their houses.
func (b *Builder) Piece(ctx context.Context, tool string, params json.RawMessage) (*semantic.Map, string, error) {
	if tool != "city" {
		return b.Generate(ctx, tool, params)
	}
	var p struct {
		Dwellings *int `json:"dwellings"`
	}
	_ = json.Unmarshal(params, &p)
	n := DefaultDwellings
	if p.Dwellings != nil {
		n = *p.Dwellings
	}
	city, key, err := b.Generate(ctx, tool, params)
	if err != nil || n <= 0 {
		return city, key, err
	}
	key = Key("city+dwellings", params)
	if m := b.cached(key); m != nil {
		return m, key, nil
	}
	m, err := b.addDwellings(ctx, city, n)
	if err != nil {
		return nil, "", err
	}
	b.store(key, m)
	return m, key, nil
}

// addDwellings returns a copy of the city where up to n houses are replaced by
// dwellings: the flat house is cleared to the street ground around it, and a
// dwelling of the same footprint is stamped with its storeys (dz +1..) and
// cellar (dz -1), entrance on the side the city put the door.
func (b *Builder) addDwellings(ctx context.Context, src *semantic.Map, n int) (*semantic.Map, error) {
	raw, _ := src.Marshal()
	m, err := semantic.Unmarshal(raw)
	if err != nil {
		return nil, err
	}
	type cand struct {
		z    semantic.Zone
		side string
	}
	var cands []cand
	for _, z := range m.Zones {
		r := z.Rect
		if z.Kind != "building" || z.DZ != 0 || r.W < minDwellW || r.H < minDwellH || r.W > 24 || r.H > 24 || hasTag(z, "castle", "keep", "temple", "gate") {
			continue
		}
		if side := doorSide(m, r); side != "" {
			cands = append(cands, cand{z, side})
		}
	}
	// Biggest first, ties by position, so the choice is stable.
	sort.SliceStable(cands, func(i, j int) bool {
		ai, aj := cands[i].z.Rect.W*cands[i].z.Rect.H, cands[j].z.Rect.W*cands[j].z.Rect.H
		if ai != aj {
			return ai > aj
		}
		return cands[i].z.Rect.Y*m.W+cands[i].z.Rect.X < cands[j].z.Rect.Y*m.W+cands[j].z.Rect.X
	})
	if len(cands) > n {
		cands = cands[:n]
	}
	placed := 0
	for k, c := range cands {
		r := c.z.Rect
		params := map[string]any{
			"seed": seedFor(src.Seed, fmt.Sprintf("%d,%d", r.X, r.Y), "dwelling"), "width": r.W + 2, "height": r.H + 2,
			"tags": []string{"large"}, "entrance": c.side, "plan": planFor(c.z), "basement": (r.X*7+r.Y*13)%5 < 2,
		}
		if c.z.Name != "" {
			params["name"] = c.z.Name
		}
		pj, _ := json.Marshal(params)
		d, _, err := b.Generate(ctx, "dwelling", pj)
		if err != nil {
			m.Warn("dwelling at %d,%d: %v", r.X, r.Y, err)
			continue
		}
		clearHouse(m, r)
		stampDwelling(m, d, r.X-1, r.Y-1, fmt.Sprintf("house%d/", k+1))
		placed++
	}
	m.Meta["dwellings"] = placed
	return m, nil
}

func hasTag(z semantic.Zone, tags ...string) bool {
	for _, t := range z.Tags {
		for _, x := range tags {
			if t == x {
				return true
			}
		}
	}
	return false
}

func planFor(z semantic.Zone) string {
	switch {
	case hasTag(z, "inn", "tavern"):
		return "tavern"
	case hasTag(z, "patriciate", "administration", "townhall"):
		return "gothic"
	}
	return "regular"
}

// doorSide finds the side of r that holds a city door marker ("" if none).
func doorSide(m *semantic.Map, r semantic.Rect) string {
	for _, mk := range m.Markers {
		if mk.DZ != 0 || len(mk.Name) < 5 || mk.Name[:5] != "door_" {
			continue
		}
		x, y := mk.X, mk.Y
		inX, inY := x >= r.X && x < r.X+r.W, y >= r.Y && y < r.Y+r.H
		switch {
		case inX && (y == r.Y || y == r.Y-1):
			return "n"
		case inX && (y == r.Y+r.H-1 || y == r.Y+r.H):
			return "s"
		case inY && (x == r.X || x == r.X-1):
			return "w"
		case inY && (x == r.X+r.W-1 || x == r.X+r.W):
			return "e"
		}
	}
	return ""
}

// clearHouse replaces a building with the most common walkable ground on the
// ring of cells just outside it.
func clearHouse(m *semantic.Map, r semantic.Rect) {
	g := m.Ground()
	count := map[string]int{}
	for x := r.X - 1; x <= r.X+r.W; x++ {
		for y := r.Y - 1; y <= r.Y+r.H; y++ {
			if r.Contains(x, y) || !g.In(x, y) {
				continue
			}
			t := g.GroundAt(x, y)
			if t == "" || hasPrefix(t, "wall") || hasPrefix(t, "water") || hasPrefix(t, "floor") {
				continue
			}
			count[t]++
		}
	}
	street, best := "ground/cobble", 0
	keys := make([]string, 0, len(count))
	for t := range count {
		keys = append(keys, t)
	}
	sort.Strings(keys)
	for _, t := range keys {
		if count[t] > best {
			street, best = t, count[t]
		}
	}
	for y := r.Y; y < r.Y+r.H; y++ {
		for x := r.X; x < r.X+r.W; x++ {
			if c := g.At(x, y); c != nil {
				c.Ground, c.Items, c.Blocked = street, nil, nil
			}
		}
	}
}

func hasPrefix(t, p string) bool {
	return t == p || len(t) > len(p) && t[:len(p)] == p && t[len(p)] == '/'
}

// stampDwelling writes every floor of d into m at (ox, oy), with markers and
// links namespaced by prefix and zones offset.
func stampDwelling(m, d *semantic.Map, ox, oy int, prefix string) {
	zoneBase := len(m.Zones)
	for _, f := range d.Floors {
		dst := m.Floor(f.DZ)
		semantic.Stamp(dst, f, ox, oy)
		for y := 0; y < f.H; y++ {
			for x := 0; x < f.W; x++ {
				s := &f.Cells[y*f.W+x]
				if c := dst.At(ox+x, oy+y); c != nil && !s.IsVoid() {
					c.Zone = 0
					if s.Zone > 0 {
						c.Zone = zoneBase + s.Zone
					}
				}
			}
		}
	}
	for _, z := range d.Zones {
		z.ID += zoneBase
		z.Rect.X += ox
		z.Rect.Y += oy
		z.Cells = nil
		m.Zones = append(m.Zones, z)
	}
	for _, mk := range d.Markers {
		m.Mark(prefix+mk.Name, mk.X+ox, mk.Y+oy, mk.DZ)
	}
	for _, l := range d.Links {
		l.From, l.To = prefix+l.From, prefix+l.To
		m.Links = append(m.Links, l)
	}
}
