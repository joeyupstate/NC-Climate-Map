const DATA_URL = `${import.meta.env.BASE_URL}data`;

async function fetchData(name) {
  const res = await fetch(`${DATA_URL}/${name}`);
  if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
  return res;
}

export const fetchJson = async (name) => (await fetchData(name)).json();

// The 800 m statewide grid: nc-grid-800m.json (geometry) + .bin (Int8, °F × 2,
// -128 = no data). Returns { meta, lows } with one Float32Array per season, NaN = no data.
export async function fetchGrid(name) {
  const [meta, buffer] = await Promise.all([
    fetchJson(`${name}.json`),
    fetchData(`${name}.bin`).then((res) => res.arrayBuffer()),
  ]);
  const packed = new Int8Array(buffer);
  const size = meta.rows * meta.cols;
  const lows = meta.seasons.map((_, s) =>
    Float32Array.from(packed.subarray(s * size, (s + 1) * size), (v) => (v === -128 ? NaN : v / 2)),
  );
  return { meta, lows };
}
