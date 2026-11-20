import { mkdir, copyFile, cp, readFile, writeFile } from "node:fs/promises";
await mkdir("public/assets/vendor", { recursive: true });
await copyFile(
  "node_modules/leaflet/dist/leaflet.js",
  "public/assets/vendor/leaflet.js",
);
await copyFile(
  "node_modules/leaflet/dist/leaflet.css",
  "public/assets/vendor/leaflet.css",
);
await cp("node_modules/leaflet/dist/images", "public/assets/vendor/images", {
  recursive: true,
});
await copyFile(
  "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "public/assets/vendor/inter-latin.woff2",
);
// Heroicons path data is licensed MIT; use the shipped 16px icon set.
const names = [
  "MapPinIcon",
  "UserIcon",
  "ClockIcon",
  "Bars3Icon",
  "XMarkIcon",
  "ArrowRightStartOnRectangleIcon",
  "CheckCircleIcon",
  "TruckIcon",
  "BanknotesIcon",
];
const icons = {};
for (const name of names) {
  const source = await readFile(
    `node_modules/@heroicons/react/16/solid/${name}.js`,
    "utf8",
  );
  icons[name] = [...source.matchAll(/\bd: "([^"]+)"/g)].map(
    (match) => match[1],
  );
}
await writeFile("public/assets/icons.json", JSON.stringify(icons));
await copyFile(
  "node_modules/leaflet/LICENSE",
  "public/assets/vendor/LEAFLET-LICENSE",
);
await copyFile(
  "node_modules/@heroicons/react/LICENSE",
  "public/assets/vendor/HEROICONS-LICENSE",
);
await copyFile(
  "node_modules/@fontsource-variable/inter/LICENSE",
  "public/assets/vendor/INTER-LICENSE",
);
console.log("Assets locales preparados.");
