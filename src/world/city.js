import * as THREE from 'three/webgpu';
import { ChunkedBatches } from '../core/geo.js';
import { ROOF_HIP } from '../core/physics.js';
import { FLOOR_H, GROUND_H } from './textures.js';
import { AVENUE, PLAZA, BASILICA, CITY_WEST, CITY_EAST, SPIRE, BRIDGE } from './layout.js';

const BAY = 3.2;
const ROOF_PITCH = Math.tan( THREE.MathUtils.degToRad( 24 ) );
const tmpColor = new THREE.Color();

function overlaps( a, b, m = 0 ) {

	return a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

}

// Split a 1-D span into lot widths.
function splitSpan( len, rng, min = 7, max = 17 ) {

	const out = [];
	let left = len;
	while ( left > 0 ) {

		if ( left < min * 2 ) {

			out.push( left );
			break;

		}

		const w = Math.min( left - min, rng.range( min, max ) );
		out.push( w );
		left -= w;

	}

	return out;

}

// Street lines: alternating blocks & streets outwards from a seed edge.
function spans( from, to, dir, rng, blockMin, blockMax, streetMin, streetMax ) {

	const out = [];
	let edge = from;
	while ( dir > 0 ? edge < to : edge > to ) {

		const b = rng.range( blockMin, blockMax );
		const a = edge, c = edge + dir * b;
		out.push( dir > 0 ? [ a, c ] : [ c, a ] );
		edge = c + dir * rng.range( streetMin, streetMax );

	}

	return out;

}

export function buildCity( scene, physics, tex, rng ) {

	const group = new THREE.Group();
	group.name = 'city';
	scene.add( group );

	const std = ( opts ) => new THREE.MeshStandardMaterial( { vertexColors: true, metalness: 0, ...opts } );
	const materials = {
		up0: std( { map: tex.upper[ 0 ].map, roughnessMap: tex.upper[ 0 ].roughnessMap } ),
		up1: std( { map: tex.upper[ 1 ].map, roughnessMap: tex.upper[ 1 ].roughnessMap } ),
		up2: std( { map: tex.upper[ 2 ].map, roughnessMap: tex.upper[ 2 ].roughnessMap } ),
		gr0: std( { map: tex.ground[ 0 ].map, roughnessMap: tex.ground[ 0 ].roughnessMap } ),
		gr1: std( { map: tex.ground[ 1 ].map, roughnessMap: tex.ground[ 1 ].roughnessMap } ),
		plain: std( { map: tex.plain, roughness: 0.92 } ),
		roof: std( { map: tex.roof.map, bumpMap: tex.roof.bumpMap, bumpScale: 2.5, roughness: 0.8 } ),
		flat: std( { roughness: 0.95 } ),
	};

	const batches = new ChunkedBatches( 160 );
	const roofSpots = [];
	const parks = [];
	const exclusions = [
		{ ...PLAZA },
		{ x0: BASILICA.x0 - 8, x1: BASILICA.x1 + 22, z0: BASILICA.z0 - 8, z1: BASILICA.z1 + 8 },
		{ x0: - 2000, x1: 2000, z0: AVENUE.z0, z1: AVENUE.z1 },
	];

	const generateDistrict = ( area, opts ) => {

		// x strips go away from the river (west bank) / from the quay (east bank)
		const xs = spans( opts.xFrom, opts.xTo, opts.xDir, rng, 42, 82, 8, 13 );
		const zsN = spans( AVENUE.z0, area.z0, - 1, rng, 40, 78, 8, 13 );
		const zsS = spans( AVENUE.z1, area.z1, 1, rng, 40, 78, 8, 13 );
		const zs = [ ...zsN, ...zsS ];

		for ( const [ bx0, bx1 ] of xs ) {

			for ( const [ bz0, bz1 ] of zs ) {

				const block = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
				const dist = Math.hypot( ( bx0 + bx1 ) / 2 - SPIRE.x, ( bz0 + bz1 ) / 2 - SPIRE.z );
				if ( rng.chance( opts.parkChance ) && dist > 150 ) {

					parks.push( block );
					continue;

				}

				generateBlock( block, dist, opts );

			}

		}

	};

	const generateBlock = ( b, dist, opts ) => {

		const bw = b.x1 - b.x0, bd = b.z1 - b.z0;
		let d = rng.range( 11, 16 );
		const lots = [];
		const hasCourtZ = bd >= 2 * d + 10;
		const hasCourtX = bw >= 2 * d + 10;
		if ( ! hasCourtZ ) d = bd / 2;

		const strip = ( x0, x1, z0, z1, alongX, inner ) => {

			const len = alongX ? x1 - x0 : z1 - z0;
			let p = alongX ? x0 : z0;
			for ( const w of splitSpan( len, rng ) ) {

				const lot = alongX ? { x0: p, x1: p + w, z0, z1 } : { x0, x1, z0: p, z1: p + w };
				lot.inner = inner; // which face looks into the courtyard
				lots.push( lot );
				p += w;

			}

		};

		strip( b.x0, b.x1, b.z0, b.z0 + d, true, hasCourtZ ? 's' : null );
		strip( b.x0, b.x1, b.z1 - d, b.z1, true, hasCourtZ ? 'n' : null );
		if ( hasCourtZ ) {

			if ( hasCourtX ) {

				strip( b.x0, b.x0 + d, b.z0 + d, b.z1 - d, false, 'e' );
				strip( b.x1 - d, b.x1, b.z0 + d, b.z1 - d, false, 'w' );

			} else {

				strip( b.x0, b.x1, b.z0 + d, b.z1 - d, false, null );

			}

		}

		const floorsMax = dist < 350 ? opts.floorsNear : opts.floorsFar;
		for ( const lot of lots ) {

			if ( exclusions.some( ( e ) => overlaps( lot, e, 2 ) ) ) continue;
			if ( rng.chance( opts.gapChance ) ) continue;
			const floors = rng.int( floorsMax[ 0 ], floorsMax[ 1 ] );
			const flat = rng.chance( opts.flatChance );
			emitBuilding( lot, b, floors, flat, opts );

		}

	};

	const emitBuilding = ( lot, b, floors, flat, opts ) => {

		const { x0, x1, z0, z1 } = lot;
		const cx = ( x0 + x1 ) / 2, cz = ( z0 + z1 ) / 2;
		const H = GROUND_H + floors * FLOOR_H + 0.6;
		const style = opts.modern && rng.chance( 0.6 ) ? 2 : rng.int( 0, 2 );
		const upKey = 'up' + style, grKey = 'gr' + rng.int( 0, 1 );

		const lum = rng.chance( 0.15 ) ? rng.range( 0.72, 0.82 ) : rng.range( 0.88, 1.05 );
		const stone = new THREE.Color( lum, lum * rng.range( 0.95, 1.0 ), lum * rng.range( 0.88, 0.98 ) );
		const corniceCol = stone.clone().multiplyScalar( 1.06 );
		const up = batches.get( cx, cz, upKey );
		const gr = batches.get( cx, cz, grKey );
		const plain = batches.get( cx, cz, 'plain' );
		const uOff = rng.int( 0, 3 ) / 4;

		const faceKind = ( f ) => {

			if ( f === 'n' && Math.abs( z0 - b.z0 ) < 0.01 ) return 'street';
			if ( f === 's' && Math.abs( z1 - b.z1 ) < 0.01 ) return 'street';
			if ( f === 'w' && Math.abs( x0 - b.x0 ) < 0.01 ) return 'street';
			if ( f === 'e' && Math.abs( x1 - b.x1 ) < 0.01 ) return 'street';
			if ( f === lot.inner ) return 'court';
			return 'party';

		};

		const faces = {
			s: [ x0, z1, x1, z1 ],
			e: [ x1, z1, x1, z0 ],
			n: [ x1, z0, x0, z0 ],
			w: [ x0, z0, x0, z1 ],
		};

		const out = { n: 0, s: 0, e: 0, w: 0 };
		for ( const f in faces ) {

			const [ ax, az, bx, bz ] = faces[ f ];
			const kind = faceKind( f );
			if ( kind === 'party' ) {

				plain.wall( ax, az, bx, bz, 0, H, 3.2, 3.2, stone );
				continue;

			}

			const len = Math.hypot( bx - ax, bz - az );
			const bays = Math.max( 1, Math.round( len / BAY ) );
			const uSize = ( len / bays ) * 4;
			( kind === 'street' ? gr : up ).wall( ax, az, bx, bz, 0, GROUND_H, uSize, kind === 'street' ? GROUND_H : FLOOR_H, stone, uOff, kind === 'street' ? 0 : 0.0 );
			up.wall( ax, az, bx, bz, GROUND_H, H - 0.6, uSize, FLOOR_H, stone, uOff );
			plain.wall( ax, az, bx, bz, H - 0.6, H, 3.2, 3.2, stone );
			if ( kind === 'street' ) out[ f ] = 0.35;

		}

		// cornice & string course, protruding on street faces only
		const cx0 = x0 - out.w, cx1 = x1 + out.e, cz0 = z0 - out.n, cz1 = z1 + out.s;
		plain.box( cx0, H - 0.45, cz0, cx1, H, cz1, 3.2, corniceCol, 'nsewb' + ( flat ? 't' : '' ) );
		const sc = ( v ) => v ? 0.14 : 0;
		plain.box( x0 - sc( out.w ), GROUND_H - 0.25, z0 - sc( out.n ), x1 + sc( out.e ), GROUND_H, z1 + sc( out.s ), 3.2, corniceCol,
			( out.n ? 'n' : '' ) + ( out.s ? 's' : '' ) + ( out.e ? 'e' : '' ) + ( out.w ? 'w' : '' ) + 't' );

		if ( flat ) {

			const roofCol = new THREE.Color().setHSL( 0.08, 0.05, rng.range( 0.42, 0.55 ) );
			batches.get( cx, cz, 'flat' ).box( cx0 + 0.3, H, cz0 + 0.3, cx1 - 0.3, H + 0.15, cz1 - 0.3, 3, roofCol, 't' );
			physics.add( x0, 0, z0, x1, H, z1, null );
			roofSpots.push( { x: cx, y: H + 0.15, z: cz } );
			return;

		}

		const rh = Math.min( cx1 - cx0, cz1 - cz0 ) * 0.5 * ROOF_PITCH;
		const lumR = rng.range( 0.7, 1.08 );
		const roofCol = new THREE.Color( lumR, lumR * rng.range( 0.82, 1.0 ), lumR * rng.range( 0.78, 0.98 ) );
		if ( rng.chance( 0.08 ) ) roofCol.setRGB( 0.62, 0.55, 0.5 );
		hipRoof( batches.get( cx, cz, 'roof' ), cx0, cz0, cx1, cz1, H, rh, roofCol );
		physics.add( x0, 0, z0, x1, H, z1, { type: ROOF_HIP, h: rh } );
		roofSpots.push( { x: cx, y: H + rh, z: cz } );

		// chimneys
		const nCh = rng.int( 0, 2 );
		for ( let i = 0; i < nCh; i ++ ) {

			const alongX = ( x1 - x0 ) >= ( z1 - z0 );
			const t = rng.range( 0.25, 0.75 );
			const px = alongX ? x0 + ( x1 - x0 ) * t : cx + rng.range( - 1, 1 );
			const pz = alongX ? cz + rng.range( - 1, 1 ) : z0 + ( z1 - z0 ) * t;
			const ch = H + rh + rng.range( 0.4, 1.3 );
			const sx = rng.range( 0.5, 0.8 ), sz = rng.range( 0.9, 1.8 );
			tmpColor.setRGB( 0.85, 0.72, 0.62 );
			plain.box( px - sx, H, pz - sz / 2, px + sx, ch, pz + sz / 2, 3.2, tmpColor, 'nsewt' );
			plain.box( px - sx - 0.08, ch, pz - sz / 2 - 0.08, px + sx + 0.08, ch + 0.12, pz + sz / 2 + 0.08, 3.2, tmpColor, 'nsewt' );

		}

	};

	// West bank — the dense old town.
	generateDistrict( CITY_WEST, {
		xFrom: CITY_WEST.x1, xTo: CITY_WEST.x0, xDir: - 1,
		floorsNear: [ 1, 4 ], floorsFar: [ 1, 3 ], flatChance: 0.04, gapChance: 0.03, parkChance: 0.03,
	} );
	// East bank — La Bastide: lower, airier, more modern blocks and parks.
	generateDistrict( CITY_EAST, {
		xFrom: CITY_EAST.x0, xTo: CITY_EAST.x1, xDir: 1,
		floorsNear: [ 1, 3 ], floorsFar: [ 1, 2 ], flatChance: 0.35, gapChance: 0.2, parkChance: 0.22, modern: true,
	} );

	const meshes = batches.build( materials, group );
	return { group, meshes, roofSpots, parks, materials, BRIDGE };

}

// Hip roof over [x0,x1]x[z0,z1] at eave height H with ridge height rh.
export function hipRoof( batch, x0, z0, x1, z1, H, rh, col, tile = 3 ) {

	const w = x1 - x0, d = z1 - z0;
	const top = H + rh;
	const slope = Math.hypot( Math.min( w, d ) / 2, rh ) / tile;
	if ( w >= d ) {

		const zm = ( z0 + z1 ) / 2, xa = x0 + d / 2, xb = x1 - d / 2;
		const uw = w / tile;
		batch.quad( [ x0, H, z1 ], [ x1, H, z1 ], [ xb, top, zm ], [ xa, top, zm ], [ 0, slope, uw, slope, ( xb - x0 ) / tile, 0, ( xa - x0 ) / tile, 0 ], col );
		batch.quad( [ x1, H, z0 ], [ x0, H, z0 ], [ xa, top, zm ], [ xb, top, zm ], [ 0, slope, uw, slope, ( x1 - xa ) / tile, 0, ( x1 - xb ) / tile, 0 ], col );
		batch.tri( [ x0, H, z0 ], [ x0, H, z1 ], [ xa, top, zm ], [ 0, slope, d / tile, slope, d / 2 / tile, 0 ], col );
		batch.tri( [ x1, H, z1 ], [ x1, H, z0 ], [ xb, top, zm ], [ 0, slope, d / tile, slope, d / 2 / tile, 0 ], col );

	} else {

		const xm = ( x0 + x1 ) / 2, za = z0 + w / 2, zb = z1 - w / 2;
		const ud = d / tile;
		batch.quad( [ x1, H, z1 ], [ x1, H, z0 ], [ xm, top, za ], [ xm, top, zb ], [ 0, slope, ud, slope, ( z1 - za ) / tile, 0, ( z1 - zb ) / tile, 0 ], col );
		batch.quad( [ x0, H, z0 ], [ x0, H, z1 ], [ xm, top, zb ], [ xm, top, za ], [ 0, slope, ud, slope, ( zb - z0 ) / tile, 0, ( za - z0 ) / tile, 0 ], col );
		batch.tri( [ x1, H, z0 ], [ x0, H, z0 ], [ xm, top, za ], [ 0, slope, w / tile, slope, w / 2 / tile, 0 ], col );
		batch.tri( [ x0, H, z1 ], [ x1, H, z1 ], [ xm, top, zb ], [ 0, slope, w / tile, slope, w / 2 / tile, 0 ], col );

	}

}

