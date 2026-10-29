package terrain

import (
	"encoding/json"
	"testing"
)

func TestLab(t *testing.T) {
	p := Default()
	for _, o := range []LabOptions{{Mode: "matrix"}, {Mode: "matrix", Set: "ship"}, {Mode: "one", A: "water"}, {Mode: "pair", A: "water", B: "sand"}} {
		d, err := Lab(p, o)
		if err != nil {
			t.Fatalf("%+v: %v", o, err)
		}
		if len(d.Floors) != 1 || len(d.Floors[0].Cells) != d.W*d.H*4 {
			t.Fatalf("%+v: bad floor", o)
		}
		if len(d.Zones) == 0 {
			t.Errorf("%+v: no patches", o)
		}
	}
	if _, err := Lab(p, LabOptions{Mode: "pair", A: "nope", B: "sand"}); err == nil {
		t.Error("unknown material accepted")
	}
}

// Built-in themes only name materials and drawers that exist.
func TestThemes(t *testing.T) {
	p := Default()
	list := Themes{Dir: t.TempDir()}.List()
	if len(list) < 8 || list[0].Name != "default" {
		t.Fatalf("themes: %+v", list)
	}
	for _, in := range list {
		b, err := Themes{}.Get(in.Name)
		if err != nil {
			t.Fatal(err)
		}
		var th Theme
		if err := json.Unmarshal(b, &th); err != nil {
			t.Fatalf("%s: %v", in.Name, err)
		}
		for name := range th.Materials {
			if p.ID(name) < 0 {
				t.Errorf("%s: unknown material %q", in.Name, name)
			}
		}
	}
	dir := t.TempDir()
	if err := (Themes{Dir: dir}).Save("my-moon", []byte(`{"title":"My moon","materials":{"grass":{"colors":["#000000","#111111","#222222"]}}}`)); err != nil {
		t.Fatal(err)
	}
	if err := (Themes{Dir: dir}).Save("../x", []byte(`{}`)); err == nil {
		t.Error("path in theme name accepted")
	}
}
