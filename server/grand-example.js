// gateway
building({tag: "gate", x0: -14, z0: 0, x1: 14, z1: 8, floors: 2, floorHeight: 5.5, wall: "red_sandstone", roof: "parapet", roofMaterial: "red_sandstone", doors: [], windows: 3});
portal({tag: "gate", side: "front", x: 0, z: 0, width: 7, height: 9, depth: 4, material: "red_sandstone", inlay: "marble"});
portal({tag: "gate", side: "back", x: 0, z: 8, width: 7, height: 9, depth: 4, material: "red_sandstone", inlay: "marble"});
for (let x = -11; x <= 11; x += 3.7) dome({tag: "known:gate_chhatris", x, z: 4, y: 11.75, radius: 1.1, shape: "bulb", material: "marble", finial: "gold"});
// garden with channel and cypress
garden({tag: "garden", x0: -45, z0: 8, x1: 45, z1: 98, style: "charbagh", trees: "cypress", waterTag: "channel", treeTag: "cypress_rows"});
// platform and tomb
platform({tag: "platform", x0: -26, z0: 98, x1: 26, z1: 150, height: 3, material: "marble", steps: "front"});
mausoleum({tag: "taj", x: 0, z: 124, y: 3, width: 30, height: 19, domeRadius: 8, domeTag: "dome", chhatriTag: "small_domes"});
for (const [dx, dz] of [[-24, 100], [24, 100], [-24, 148], [24, 148]]) tower({tag: "minarets", x: dx, z: dz, height: 32, radius: 1.8, material: "marble", balconies: 3, cap: "chhatri"});
// mosque and jawab
for (const sx of [-1, 1]) {
  const t = sx < 0 ? "mosque" : "jawab";
  building({tag: t, x0: sx * 34 - 9, z0: 114, x1: sx * 34 + 9, z1: 134, y: 1, floors: 1, floorHeight: 9, wall: "red_sandstone", roof: "parapet", roofMaterial: "red_sandstone", doors: [], windows: 0});
  platform({tag: t, x0: sx * 34 - 11, z0: 112, x1: sx * 34 + 11, z1: 136, height: 1, material: "red_sandstone"});
  for (const dz of [-6, 0, 6]) dome({tag: t, x: sx * 34, z: 124 + dz, y: 10, radius: dz === 0 ? 3.5 : 2.5, shape: "bulb", material: "marble"});
}
// the river behind
box(-60, 0, 156, 60, 0.5, 168, "water", "river");
