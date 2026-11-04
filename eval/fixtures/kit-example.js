// boundary: nobody described it, but a courtyard house is walled; the gate sits in the front wall
enclosure({x0: -9, z0: 0, x1: 9, z1: 17, height: 2.4, tag: "unsaid:boundary_wall", gap: {side: "front", width: 2.5}});
gate({tag: "gate", x: 0, z: 0, width: 2.5, color: "blue", postsTag: "unsaid:gate_posts"});
floor({x0: -8.5, z0: 0.5, x1: 8.5, z1: 12, material: "earth", tag: "courtyard"});
// near the gate on the left: the hand pump, and the chulha next to it
handpump({tag: "hand_pump", x: -3.25, z: 2});
chulha({tag: "chulha", x: -5.25, z: 2.25});
// the neem on the right side, shading the yard
tree({tag: "neem_tree", x: 5.5, z: 6.5, kind: "neem"});
// at the back, side by side: grain room on the left, grandmother's room (3.7 by 3 m) on the right
room({tag: "grain_room", x0: -8.5, z0: 12, x1: -1, z1: 16.5, doors: [{side: "front", at: "center"}], roofTag: "roof"});
room({tag: "grandmother_room", x0: -0.5, z0: 13.25, x1: 3.25, z1: 16.5, doors: [{side: "front", at: "center", color: "blue"}], windows: [{side: "front", at: 0.5}], roofTag: "roof"});
charpai({tag: "manji", x: 1.4, z: 15.4, along: "x"});
// the ladder against the front of the grain room, up to the roof
ladder({tag: "ladder", x: -3, z: 11.75, height: 3.25, along: "x"});