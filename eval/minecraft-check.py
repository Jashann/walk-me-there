#!/usr/bin/env python3
"""Compares a built place in Minecraft with its data pack: 2,000 random blocks per place.

Writes a data pack function that adds 1 to a score for each sampled block that differs from the file.
Usage: python3 eval/minecraft-check.py walkmethere.zip WORLD/datapacks > steps.txt, then run those
commands in the game (or over RCON) after placing the pack at the same origin.
"""
import os, random, re, sys, zipfile

pack, datapacks = sys.argv[1:3]
text = zipfile.ZipFile(pack).read("data/walkmethere/function/place.mcfunction").decode()
cells = {(x, y, z): b for x, y, z, b in re.findall(r"^setblock ~(-?\d+) ~(-?\d+) ~(-?\d+) (\S+)$", text, re.M)}
if not cells:
    sys.exit("No plain setblock lines found: expand any fill commands in the pack first.")
random.seed(5)
sample = random.sample(list(cells.items()), min(2000, len(cells)))
fn = os.path.join(datapacks, "chk/data/chk/function")
os.makedirs(fn, exist_ok=True)
with open(os.path.join(datapacks, "chk/pack.mcmeta"), "w") as f:
    f.write('{"pack":{"description":"block check","min_format":121,"max_format":121}}')
with open(os.path.join(fn, "c.mcfunction"), "w") as f:
    for (x, y, z), b in sample:
        f.write(f"execute unless block ~{x} ~{y} ~{z} {b} run scoreboard players add misses wmt 1\n")
print("scoreboard objectives add wmt dummy")
print("scoreboard players set misses wmt 0")
print("reload")
print("function chk:c   (run it at the origin used for walkmethere:place)")
print(f"scoreboard players get misses wmt   (out of {len(sample)})")
