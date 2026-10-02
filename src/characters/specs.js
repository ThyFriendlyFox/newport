// Parameter sets fed to Rig. Everything visual about a character lives here.

export const PROTAGONIST = {
	name: 'kid',
	scale: 1.0, // ~1.62 m
	skin: 0xf6dccb,
	skinCell: 'skin',
	shadowTint: 0xd08a90,
	rim: 0.35,
	outlineColor: 0x2b2234,
	proportions: { shoulderWidth: 0.165, hipWidth: 0.085, armLength: 0.56, build: 0.96, limb: 0.92 },
	head: { size: 1.08, jaw: 1.0 },
	hair: {
		color: 0xaed6bf, seed: 7, capAngle: 1.7, capScale: 1.06, layers: 2, count: 16, frontGap: 0.7,
		length: 0.19, sideExtra: 0.06, bangs: 5, bangSpread: 0.8, bangLength: 0.095, bangLean: 0.3,
		tufts: 4, tuftLength: 0.08,
	},
	catEars: true,
	tail: { segments: 10, segLen: 0.062, radius: 0.024, color: 0x3a3a3f },
	clothes: {
		shirtColor: 0xf7ef9a, shirtCell: 'cotton', shirtHem: 0.80, shirtLoose: 0.035, collar: true, collarColor: 0xefe27d,
		sleeveLength: 0.42, sleeveLoose: 1.15,
		pantsColor: 0x4a678f, pantsCell: 'denim', pantsLength: 0.93, pantsLoose: 0.035,
		ragged: 0,
	},
	shoes: { color: 0x7f8c3e, cell: 'crocs' },
	face: 'kid',
	eyes: { iris: '#c98b2e', irisDark: '#6b3f0c', shape: 'round' },
};

const zombieBase = {
	name: 'zombie',
	scale: 1.1,
	skinCell: 'deadSkin',
	shadowTint: 0x5a4a52,
	rim: 0.22,
	outlineColor: 0x15110f,
	proportions: { shoulderWidth: 0.175, hipWidth: 0.09, armLength: 0.6, build: 0.9, limb: 0.82 },
	head: { size: 1.0, jaw: 0.75 },
	hair: {
		color: 0x17120f, seed: 3, capAngle: 1.35, capScale: 1.005, layers: 1, count: 0, frontGap: 1.1,
		length: 0.03, sideExtra: 0.0, bangs: 0, bangSpread: 0.6, bangLength: 0.03, bangLean: 0,
		tufts: 0, tuftLength: 0.03,
	},
	catEars: false,
	tail: null,
	clothes: {
		shirtColor: 0xffffff, shirtCell: 'flannel', shirtHem: 0.78, shirtLoose: 0.02, collar: true, collarColor: 0x5c6e85,
		sleeveLength: 0.95, sleeveLoose: 1.0,
		pantsColor: 0xffffff, pantsCell: 'ragPants', pantsLength: 0.8, pantsLoose: 0.012,
		ragged: 1,
	},
	shoes: null,
	face: 'zombie',
	eyes: { iris: '#e8d98a', irisDark: '#5c5020', shape: 'glazed' },
};

export const ZOMBIES = [
	{ ...zombieBase, skin: 0x5b3f33, hair: { ...zombieBase.hair, seed: 3 } },
	{ ...zombieBase, skin: 0x7a5a48, scale: 1.04, hair: { ...zombieBase.hair, seed: 11, count: 14 }, clothes: { ...zombieBase.clothes, shirtCell: 'tee', shirtColor: 0x8a8d90, sleeveLength: 0.4, collar: false } },
	{ ...zombieBase, skin: 0x4a3129, scale: 1.14, proportions: { ...zombieBase.proportions, build: 1.0, limb: 0.9 }, hair: { ...zombieBase.hair, seed: 23, count: 10, capAngle: 1.2 }, clothes: { ...zombieBase.clothes, pantsCell: 'denim', shirtColor: 0xcfcfd4 } },
];
