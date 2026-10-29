# Automix maps

A map tool that joins two experiments. The Watabou generators from `../map-tools-watabou` build the maps. The tileset-free shader idea from `../auto-tiles` draws them. Nothing uses a sprite asset. Every material and prop is drawn in code.

The result is walkable. Water, walls, cliffs, trees and furniture block. Stairs, holes and cave mouths move you between floors.

## Run

```
go run ./cmd/automix            # http://127.0.0.1:7788
go run ./cmd/automix -dev       # serve web/static from disk while editing the frontend
go test ./...                   # every generator and a full world must be playable
```

It needs Go 1.26, a browser with WebGL2, and `../map-tools-watabou` next to this folder (`go.mod` points there with a `replace`).

## What it does

- World tab. A realm surface is generated, and every site it proposes is filled with the matching generator. Cities and towns of 64×64 or more get `city`, smaller towns get `village`, caves get `cave`, dungeons get `dungeon`. tilegen's `compose` package stamps them in, so caves and dungeons land on dz -1 and -2 under their mouths. Each site can be rerolled, switched to another generator, cleared or refilled. City rows also set how many houses become dwellings. Only that piece regenerates, since maps are cached by tool and params.
- Dwellings in cities. Every city, in a world or alone, rebuilds its biggest houses (6 by default, `dwellings` in the city params) with the dwelling generator. The flat house is cleared to the street ground around it, and a dwelling of the same footprint goes in with its door on the side the city chose. Its storeys land on dz +1 and up, and some get a cellar on dz -1, all linked by stairs. Inns get the tavern room set, patrician and administration houses the gothic one. The keep, the temple and gatehouses are left alone, and so are houses under 7×6, the smallest dwelling footprint.
- Sub-map tab. Any single generator with its full parameter form: realm, city, village, cave (and glade), dungeon, dwelling.
- Lab tab. The edge lab, generated instead of hand-placed. "Every pair" is a matrix with one patch per pair of materials (49×49), optionally limited to one kit, followed by every prop on grass and on stone. Each patch is the base material with the other as a lone tile, a 2×2 block, a line, a diagonal and an L. "One against all" lays one material against each other one, both ways round. "Edge cases of a pair" is the full auto-tiles board for two materials: lone tiles, a saddle, a checkerboard, lines, a diagonal, a staircase, a four-way corner, inner corners and a disc, with the roles swapped on the right half. The HUD names the patch under you.
- Themes tab. Pick, edit and save themes, live on whatever map is loaded. See below.
- View tab. Render mode (final, raw ids, no noise, colliders in red), edge noise, zoom, grid, labels, minimap, no-clip, and a floor jump list.
- Exports. The terrain map JSON (what the viewer plays), the semantic map (re-bake it to Asterion tiles with tilegen), and the world recipe (surface params plus pieces, which regenerates the same world).

The URL hash holds the last recipe, so a link reopens the same map.

## How it works

```
tilegen generator ──► semantic map (tags) ──► pkg/terrain ──► terrain map ──► shader + walker
                       ground/grass, wall/house,   palette        per cell: material,
                       tree/oak, door, link/...                   underlay, raised, hash
```

The generators never change. `pkg/terrain` does the job tilegen's palette and bake did, but it targets materials instead of tile ids. The palette is `pkg/terrain/default_palette.json`. `-palette file.json` loads another one.

- `materials` is an ordered list. The index is the material id and the stacking order, as in auto-tiles. Each has a pattern, three colours, and flags. `soft` gives organic noisy edges, otherwise the cell is filled exactly. `solid` blocks. `height` makes it raised, with a front face and a shadow.
- `ground` maps ground tags to materials. Lookup falls back along the path (`ground/cobble/village` → `ground/cobble`).
- `props` maps item tags to a drawer, a colour variant and a collider (`cell` or `circle` with a radius). An entry can replace the cell's material instead (`bridge`, item fences) or be skipped (roofs).

Each map texel has 4 bytes:

| byte | meaning |
|---|---|
| R | material drawn in the cell |
| G | soft underlay. Crisp cells (floors, built walls) count as the nearest walkable soft material when soft layers blend around them. Without it, every house would grow a ring of whatever soft layer sits just below walls in the stack. |
| B | 1 if raised, for shadows |
| A | per-cell hash |

The shader picks the top material per pixel. A crisp cell always shows its own material. A soft material shows where its bilinear coverage beats a noisy threshold, and only materials present at the 4 surrounding tile centres can win, so the loop has at most 4 steps. The walker runs the same rule on the CPU without noise for collision, plus prop colliders and a small feet box.

Portals come from the semantic links (`down_1` ↔ `up_1`, `cave_mouth` ↔ `entry`). Stepping on one moves you, and it re-arms once you step off the arrival cell. Upper floors show the floor below, dimmed, through the air around them. Underground floors get a light radius around the walker.

## Themes

A theme is a skin over the palette. It can change each material's pattern, three colours, accent colour, glow, edge noise and pattern variant, swap prop drawers and their colours, bake a CSS filter into the prop sprites, and make the surface dark with a light around the walker. It never changes what is solid, soft or raised, or how tags map to materials. So any map, world or lab can be shown in any theme, and a lava sea still blocks like the water it replaces.

Built-in themes live in `pkg/terrain/themes/` (embedded). Saving from the editor writes `data/themes/<name>.json`, which wins over a built-in of the same name.

| theme | idea |
|---|---|
| `default` | the palette as it is |
| `mars` | rust ground, lava seas, dune sand for snow, red furrows, rock and crystal for trees, colony habitats with metal floors |
| `winter` | snow over everything, icy water, frozen ponds, snowy pines |
| `autumn` | golden grass, copper woods, fallen leaves, harvested fields |
| `candy` | pink sugar meadows, mint lawns, soda seas, chocolate soil, gingerbread houses |
| `toxic` | glowing green sludge, ash soil, dead woods, at night |
| `ashlands` | black ash with embers, obsidian shores, lava rivers lighting the dark |
| `alien` | night jungle: teal grass, violet moss, glowing water, neon trees |

Exported terrain maps carry the themed materials and the theme name.

## Kits and reserved tags

Every material has a `set` (kit): water, nature, settlement, interior, underground, links, ship, wood. The lab and the editor filter and group by kit.

Two kits have no generator yet. Their tags are reserved so a new generator only has to emit them:

| tag | material | look |
|---|---|---|
| `floor/metal` | metalfloor | riveted plates |
| `floor/metal/grate` | grate | walkable grating |
| `floor/metal/hazard` | hazard | plates with hazard stripes |
| `floor/tile` | tilefloor | clean square tiles |
| `floor/deck` | deck | wide plank deck |
| `wall/hull` | hullwall | raised hull panels with a light strip |
| `wall/glass` | glasswall | raised glass |
| `wall/log` | logwall | raised log wall |
| `void/space` | space | starfield, solid |

Tech props: `tech/console`, `tech/locker`, `tech/pipes`, `tech/reactor`, `tech/light`, and `door/airlock`. Adding a kit means adding materials (and a shader pattern if none fits) to the palette, then mapping its tags.

## Layout

```
cmd/automix                server and `automix gen <tool|world> -p '{json}' -o file`
pkg/terrain                palette, semantic → terrain conversion, edge lab, theme store, tests
pkg/terrain/themes         built-in themes
pkg/world                  realm + site autofill + compose, dwellings in cities, map cache
web/static/index.html      panel and HUD
web/static/src/terrain.js  the shader
web/static/src/game.js     floors, collision, portals, camera, props, minimap
web/static/src/props.js    procedural props
web/static/src/sprites.js  the walker (from auto-tiles)
web/static/src/app.js      forms from the generator schemas, world and sub-map flows
web/static/src/editor.js   lab tab and theme editor
```

## API

| method | path | body | returns |
|---|---|---|---|
| GET | `/api/tools` | | generator infos and schemas from tilegen |
| GET | `/api/palette` | | the active material palette |
| POST | `/api/generate/{tool}` | params | terrain map |
| POST | `/api/world` | `{surface, pieces, autofill, skip}` | `{request, sites, doc}` |
| GET | `/api/semantic/{id}` | | the semantic map behind a recent result |
| GET | `/api/lab` | `?mode=matrix\|one\|pair&a=&b=&set=` | a lab terrain map |
| GET | `/api/themes` | | built-in and saved themes |
| GET | `/api/themes/{name}` | | one theme |
| PUT | `/api/themes/{name}` | theme JSON | saves to `data/themes/` |

## Known gaps

- Top-down only. Walls have front faces, which the isometric view of auto-tiles would need to redo.
- Small realm seeds can have no room for caves or dungeons. The realm only places them on clear land away from towns.
- Soft wall faces have no depth gradient. Crisp walls do.
- Torches do not light the dark yet. Only the walker and glowing materials do.
- Themes recolour props with a filter or a palette swap, not per-pixel editing. Furniture keeps its drawn colours apart from the filter.
- Collision ignores the edge noise, so soft edges can be a few pixels off what is drawn, as in auto-tiles.
- Only houses of 7×6 or more can become dwellings, so small towns get few of them. NPC slot markers the city put inside a rebuilt house keep their old position.
