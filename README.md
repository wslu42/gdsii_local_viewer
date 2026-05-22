# GDSII Local Viewer

A lightweight, client-side GDSII previewer for iPhone, iPad, desktop browsers, and GitHub Pages. Files are read with the browser File API and parsed locally in JavaScript. There is no backend, no upload path, no analytics, and no remote script loading.

## Run Locally

You can open `index.html` directly in a browser.

For stricter browser module behavior, run a tiny local static server from this folder:

```powershell
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Deploy To GitHub Pages

1. Commit the files in this repository.
2. Push to GitHub.
3. In the GitHub repository, open **Settings > Pages**.
4. Choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)` folder.
6. Save and open the Pages URL after deployment finishes.

Because this is a plain static site, GitHub Pages can host it without a build step.

## Supported GDSII Records

Phase 1 parses enough binary GDSII for common polygon-based layouts:

- `HEADER`
- `BGNLIB`
- `LIBNAME`
- `UNITS`
- `BGNSTR`
- `STRNAME`
- `BOUNDARY`
- `LAYER`
- `DATATYPE`
- `XY`
- `ENDEL`
- `SREF`
- `SNAME`
- `AREF`
- `COLROW`
- `STRANS`
- `MAG`
- `ANGLE`
- `ENDSTR`
- `ENDLIB`

The parser logs or ignores unsupported records such as `TEXT`, `PATH`, `NODE`, `BOX`, `PROPATTR`, and `PROPVALUE`.

## Known Limitations

- Canvas 2D rendering is intended for quick previews, not KLayout-level inspection.
- `BOUNDARY` polygons are supported; `PATH`, `TEXT`, `BOX`, and `NODE` are not rendered.
- Hierarchy expansion has a default depth limit of 10 and a polygon guard of 50,000 polygons.
- AREF support is basic and intended for common rectangular arrays.
- Layer names, properties, text labels, path widths, datatypes beyond display grouping, and boolean geometry are not implemented.
- Very large GDS files may be slow or memory-heavy on iOS Safari.
- No OASIS support in Phase 1.

## Suggested Phase 2 Next Steps

- Add `PATH` rendering with width and end-cap support.
- Add optional text label rendering and search.
- Add a cell tree browser with selective hierarchy expansion.
- Add bbox-only rendering mode for very large hierarchies.
- Add layer color customization and persisted viewer preferences.
- Add a small corpus of known-good test GDS files and parser regression tests.
- Add measurement tools for point-to-point distance and bbox inspection.
