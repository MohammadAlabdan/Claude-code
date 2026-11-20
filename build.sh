#!/usr/bin/env bash
# Wraps site/dawri.html (artifact-style fragment) into a full document at site/index.html for Netlify.
set -euo pipefail
cd "$(dirname "$0")/site"
{
  printf '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
  cat dawri.html
  printf '\n</body>\n</html>\n'
} > index.html

# Social media studio: site/social.src.html + the brand logos → site/social.html (artifact fragment)
node -e '
const fs = require("fs"), b = "../brand/";
const L = { compactLight: "jay-logo-compact.svg", compactDark: "jay-logo-compact-on-dark.svg", fullLight: "jay-logo-horizontal.svg",
  fullDark: "jay-logo-horizontal-on-dark.svg", markLight: "jay-mark.svg", markDark: "jay-mark-on-dark.svg" };
const logos = Object.fromEntries(Object.entries(L).map(([k, f]) => [k, fs.readFileSync(b + f, "utf8").trim()]));
fs.writeFileSync("social.html", fs.readFileSync("social.src.html", "utf8").replace("/*LOGOS*/", "const LOGOS = " + JSON.stringify(logos) + ";"));
'
# …and as a full page for Netlify at /studio/
mkdir -p studio
{
  printf '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<link rel="icon" href="../assets/logo.svg" type="image/svg+xml">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style>\n</head>\n<body>\n'
  cat social.html
  printf '\n</body>\n</html>\n'
} > studio/index.html
