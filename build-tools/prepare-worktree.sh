#!/bin/sh
# Readies a linked git worktree to build and run e2e without the dictionary
# submodules or network access: installs dependencies, then copies the
# generated dictionaries, stroke graphics and OCR assets from the main checkout.
set -eu

root=$(git rev-parse --show-toplevel)
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

if [ "$root" = "$main" ]; then
  echo "✗ This is the main checkout — run 'pnpm build' here instead."
  exit 1
fi

for asset in public/data/mandarin.json public/data/cantonese.json \
  public/data/etymology.json public/data/frequency.json \
  public/strokes/index.json public/ocr/models; do
  if [ ! -e "$main/$asset" ]; then
    echo "✗ $main/$asset is missing — run 'pnpm build' in the main checkout first."
    exit 1
  fi
done

cd "$root"
pnpm install --frozen-lockfile --prefer-offline

for name in mandarin cantonese etymology frequency; do
  cp "$main/public/data/$name.json" public/data/
done
rm -rf public/strokes public/ocr
cp -R "$main/public/strokes" public/strokes
cp -R "$main/public/ocr" public/ocr

echo "✓ Worktree ready. Generated assets are the main checkout's: if this branch"
echo "  changes build-tools/, regenerate them with the matching 'pnpm build:*' step."
