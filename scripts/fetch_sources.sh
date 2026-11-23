#!/bin/sh
# Download the dictionary sources the converters read. Re-run to refresh.
set -eu
cd "$(dirname "$0")/.."
mkdir -p resources/dictionaries/perseus_ls resources/dictionaries/wiktionary
curl -sSfL -o resources/dictionaries/perseus_ls/lat.ls.perseus-eng2.xml \
  https://raw.githubusercontent.com/PerseusDL/lexica/master/CTS_XML_TEI/perseus/pdllex/lat/ls/lat.ls.perseus-eng2.xml
curl -sSfL -o resources/dictionaries/wiktionary/kaikki-latin.jsonl \
  https://kaikki.org/dictionary/Latin/kaikki.org-dictionary-Latin.jsonl
echo "Fetched. Now run: npm run data:convert"
