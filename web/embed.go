// Package web holds the browser app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static
var files embed.FS

// Static is the app root (index.html and src/).
func Static() fs.FS {
	sub, _ := fs.Sub(files, "static")
	return sub
}
