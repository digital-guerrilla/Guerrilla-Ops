#!/usr/bin/env python3
"""
Build script for Guerrilla Ops
Combines dev/index.html with all CSS and JS modules into a single
self-contained HTML file written to release/Guerrilla-Ops.html.

Usage:
    python build_release.py
"""
import os
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.dirname(SCRIPT_DIR)
DEV_DIR     = os.path.join(ROOT_DIR, 'dev')
CSS_DIR     = os.path.join(DEV_DIR, 'css')
JS_DIR      = os.path.join(DEV_DIR, 'javascript')
RELEASE_DIR = os.path.join(ROOT_DIR, 'release')

# CSS files in load order (must match <link> order in index.html)
CSS_FILES = [
    'theme.css',
    'header.css',
    'upload.css',
    'filter.css',
    'results.css',
]

# JS modules in load order (must match the <script src="..."> order in index.html)
JS_MODULES = [
    'state.js',
    'utils.js',
    'cobie-parser.js',
    'app-lifecycle.js',
    'filters.js',
    'panels.js',
    'pills.js',
    'results.js',
    'floor-svg-panel.js',
    'three-d-viewer.js',
    'documents.js',
    'qa.js',
    'modals.js',
    'edit.js',
    'create.js',
    'export.js',
    'resize.js',
    'init.js',
]


def read(path):
    with open(path, 'r', encoding='utf-8') as fh:
        return fh.read()


def build():
    os.makedirs(RELEASE_DIR, exist_ok=True)

    # ── Load template ──────────────────────────────────────────
    html = read(os.path.join(DEV_DIR, 'index.html'))

    # ── Inline CSS ─────────────────────────────────────────────
    css_parts = [read(os.path.join(CSS_DIR, f)) for f in CSS_FILES]
    css = '\n\n'.join(css_parts)
    # Replace the first CSS link and remove the rest
    first_link = f'<link rel="stylesheet" href="css/{CSS_FILES[0]}">'
    html = html.replace(first_link, f'<style>\n{css}\n  </style>')
    for f in CSS_FILES[1:]:
        html = html.replace(f'\n  <link rel="stylesheet" href="css/{f}">', '')

    # ── Concatenate JS modules ─────────────────────────────────
    js_parts = []
    for module in JS_MODULES:
        path = os.path.join(JS_DIR, module)
        js_parts.append(f'// ── {module} {"─" * max(1, 50 - len(module))}\n\n' + read(path))
    combined_js = '\n\n'.join(js_parts)

    # Remove all individual <script src="javascript/..."> tags
    html = re.sub(r'\n?<script src="javascript/[^"]+\.js"></script>', '', html)

    # Insert combined JS before </body>
    html = html.replace(
        '</body>',
        f'<script>\n{combined_js}\n</script>\n\n</body>'
    )

    # ── Write output ───────────────────────────────────────────
    output_path = os.path.join(RELEASE_DIR, 'Guerrilla-Ops.html')
    root_path   = os.path.join(ROOT_DIR, 'index.html')
    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write(html)
    with open(root_path, 'w', encoding='utf-8') as fh:
        fh.write(html)

    css_kb   = sum(len(p.encode('utf-8')) for p in css_parts) / 1024
    js_kb    = len(combined_js.encode('utf-8')) / 1024
    total_kb = len(html.encode('utf-8')) / 1024
    print(f'Built:  {output_path}')
    print(f'  copy: {root_path}')
    print(f'  CSS:  {css_kb:.1f} KB')
    print(f'  JS:   {js_kb:.1f} KB  ({len(JS_MODULES)} modules)')
    print(f'  Total:{total_kb:.1f} KB')


if __name__ == '__main__':
    build()
