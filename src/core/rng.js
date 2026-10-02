// Small deterministic PRNG so the city is identical on every load.
export function createRng( seed = 1 ) {

	let s = seed >>> 0;

	const next = () => {

		s = ( s + 0x6D2B79F5 ) >>> 0;
		let t = s;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

	return {
		next,
		range: ( a, b ) => a + ( b - a ) * next(),
		int: ( a, b ) => Math.floor( a + ( b - a + 1 ) * next() ),
		pick: ( arr ) => arr[ Math.floor( next() * arr.length ) ],
		chance: ( p ) => next() < p,
	};

}
