import * as THREE from 'three/webgpu';
import { cellUV } from './atlas.js';
import { AnimeMaterial, makeOutlineMaterial } from './shading.js';

// A fully procedural, skinned humanoid. Body parts are lofted along curves with smooth radius
// profiles, skin weights are solved automatically from distance to bone capsules, and the whole
// character (skin, clothes, hair, shoes) ends up in ONE geometry with ONE material via the atlas.
//
// Character space: +Y up, +Z forward, feet at y = 0. Every bone's local +Y points to its child,
// local +Z is the character's forward (so rotation about local X swings the limb forward/back),
// and local X = Y × Z.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Geometry assembly

class SkinnedBuilder {

	constructor() {

		this.pos = [];
		this.uv = [];
		this.col = [];
		this.si = [];
		this.sw = [];
		this.idx = [];
		this.sway = [];
		this.count = 0;
		this.seams = [];
		this.parts = []; // { start, end, bones: [names], sigma }

	}

	beginPart( bones, sigma = 1 ) {

		this.part = { start: this.count, end: this.count, bones, sigma };
		this.parts.push( this.part );

	}

	vertex( p, u, v, c, sway = 0 ) {

		this.pos.push( p.x, p.y, p.z );
		this.uv.push( u, v );
		this.col.push( c.r, c.g, c.b );
		this.sway.push( sway );
		this.part.end = this.count + 1;
		return this.count ++;

	}

	// Loft a tube along `path` (array of Vector3 ring centres).
	// profile(t) -> { rx, rz, rzBack?, ox?, oz?, bulge?(angle) }
	tube( { path, profile, segs = 16, forward = new THREE.Vector3( 0, 0, 1 ), capStart = false, capEnd = false, cell = 'flat', uvRepeat = [ 1, 1 ], color = new THREE.Color( 1, 1, 1 ), colorFn = null, radialNoise = null, sway = false } ) {

		const n = path.length;
		const rings = [];
		const X = new THREE.Vector3(), Z = new THREE.Vector3(), T = new THREE.Vector3();
		let total = 0;
		const dist = [ 0 ];
		for ( let i = 1; i < n; i ++ ) {

			total += path[ i ].distanceTo( path[ i - 1 ] );
			dist.push( total );

		}

		for ( let i = 0; i < n; i ++ ) {

			const t = total > 0 ? dist[ i ] / total : i / ( n - 1 );
			if ( i === 0 ) T.subVectors( path[ 1 ], path[ 0 ] );
			else if ( i === n - 1 ) T.subVectors( path[ n - 1 ], path[ n - 2 ] );
			else T.subVectors( path[ i + 1 ], path[ i - 1 ] );
			T.normalize();
			X.crossVectors( T, forward );
			if ( X.lengthSq() < 1e-6 ) X.crossVectors( T, new THREE.Vector3( 1, 0, 0 ) );
			X.normalize();
			Z.crossVectors( X, T ).normalize();
			const pr = profile( t, i );
			const ring = [];
			for ( let s = 0; s <= segs; s ++ ) {

				const a = ( s / segs ) * Math.PI * 2;
				const ca = Math.cos( a ), sa = Math.sin( a );
				let rx = pr.rx, rz = sa >= 0 ? pr.rz : ( pr.rzBack !== undefined ? pr.rzBack : pr.rz );
				let bul = pr.bulge ? pr.bulge( a ) : 1;
				if ( radialNoise ) bul *= radialNoise( t, a );
				const p = new THREE.Vector3().copy( path[ i ] )
					.addScaledVector( X, ( pr.ox || 0 ) + rx * ca * bul )
					.addScaledVector( Z, ( pr.oz || 0 ) + rz * sa * bul );
				const [ uu, vv ] = cellUV( cell, ( s / segs ) * uvRepeat[ 0 ] % 1, ( t * uvRepeat[ 1 ] ) % 1 );
				const c = colorFn ? colorFn( t, a, p ) : color;
				ring.push( this.vertex( p, uu, vv, c, sway ? t : 0 ) );

			}

			rings.push( ring );

		}

		for ( let i = 0; i < n - 1; i ++ ) {

			for ( let s = 0; s < segs; s ++ ) {

				const a = rings[ i ][ s ], b = rings[ i ][ s + 1 ], c = rings[ i + 1 ][ s + 1 ], d = rings[ i + 1 ][ s ];
				this.idx.push( a, c, b, a, d, c );

			}

		}

		if ( capStart ) this.cap( rings[ 0 ], path[ 0 ], cell, color, true );
		if ( capEnd ) this.cap( rings[ n - 1 ], path[ n - 1 ], cell, color, false );
		this.seams.push( rings );
		return rings;

	}

	cap( ring, centre, cell, color, flip ) {

		const [ uu, vv ] = cellUV( cell, 0.5, 0.5 );
		const c = this.vertex( centre, uu, vv, color );
		for ( let s = 0; s < ring.length - 1; s ++ ) {

			if ( flip ) this.idx.push( c, ring[ s ], ring[ s + 1 ] );
			else this.idx.push( c, ring[ s + 1 ], ring[ s ] );

		}

	}

	// Deformed sphere (head, hair cap). deform(p) mutates the point.
	sphere( { centre, radius, wSegs = 28, hSegs = 20, deform = null, cell = 'flat', color, thetaStart = 0, thetaLength = Math.PI, phiStart = 0, phiLength = Math.PI * 2, colorFn = null, uvFn = null } ) {

		const grid = [];
		for ( let iy = 0; iy <= hSegs; iy ++ ) {

			const row = [];
			const v = iy / hSegs;
			for ( let ix = 0; ix <= wSegs; ix ++ ) {

				const u = ix / wSegs;
				const theta = thetaStart + v * thetaLength;
				const phi = phiStart + u * phiLength;
				// phi = 0 faces +Z (forward)
				const p = new THREE.Vector3(
					Math.sin( theta ) * Math.sin( phi ) * radius,
					Math.cos( theta ) * radius,
					Math.sin( theta ) * Math.cos( phi ) * radius
				);
				if ( deform ) deform( p, theta, phi );
				p.add( centre );
				const [ uu, vv ] = uvFn ? uvFn( u, v, p ) : cellUV( cell, u, v );
				row.push( this.vertex( p, uu, vv, colorFn ? colorFn( p, theta, phi ) : color ) );

			}

			grid.push( row );

		}

		for ( let iy = 0; iy < hSegs; iy ++ ) {

			for ( let ix = 0; ix < wSegs; ix ++ ) {

				const a = grid[ iy ][ ix ], b = grid[ iy ][ ix + 1 ], c = grid[ iy + 1 ][ ix + 1 ], d = grid[ iy + 1 ][ ix ];
				if ( iy !== 0 || thetaStart > 0 ) this.idx.push( a, c, b );
				if ( iy !== hSegs - 1 || thetaStart + thetaLength < Math.PI ) this.idx.push( a, d, c );

			}

		}

		if ( phiLength > Math.PI * 1.99 ) this.seams.push( grid );
		return grid;

	}

	build( rig ) {

		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		geo.setAttribute( 'color', new THREE.Float32BufferAttribute( this.col, 3 ) );
		geo.setAttribute( 'sway', new THREE.Float32BufferAttribute( this.sway, 1 ) );
		geo.setIndex( this.idx );
		geo.computeVertexNormals();
		// average the normals across tube seams so the duplicated seam vertex doesn't show a crease
		const nrm = geo.attributes.normal;
		for ( const rings of this.seams ) {

			for ( const ring of rings ) {

				const a = ring[ 0 ], b = ring[ ring.length - 1 ];
				_v.set( nrm.getX( a ) + nrm.getX( b ), nrm.getY( a ) + nrm.getY( b ), nrm.getZ( a ) + nrm.getZ( b ) ).normalize();
				nrm.setXYZ( a, _v.x, _v.y, _v.z );
				nrm.setXYZ( b, _v.x, _v.y, _v.z );

			}

		}

		// automatic skin weights: gaussian falloff from distance to each candidate bone's segment
		const si = new Float32Array( this.count * 4 ), sw = new Float32Array( this.count * 4 );
		const pos = geo.attributes.position;
		const scored = [];
		for ( const part of this.parts ) {

			const cands = part.bones.map( ( name ) => rig.boneInfo[ name ] );
			for ( let i = part.start; i < part.end; i ++ ) {

				_v.fromBufferAttribute( pos, i );
				scored.length = 0;
				for ( const b of cands ) {

					const d = distToSegment( _v, b.head, b.tail );
					const sigma = b.radius * part.sigma;
					scored.push( [ b.index, Math.exp( - ( d * d ) / ( 2 * sigma * sigma ) ) + 1e-6 ] );

				}

				scored.sort( ( a, b ) => b[ 1 ] - a[ 1 ] );
				let sum = 0;
				for ( let k = 0; k < 4; k ++ ) sum += scored[ k ] ? scored[ k ][ 1 ] : 0;
				for ( let k = 0; k < 4; k ++ ) {

					si[ i * 4 + k ] = scored[ k ] ? scored[ k ][ 0 ] : 0;
					sw[ i * 4 + k ] = scored[ k ] ? scored[ k ][ 1 ] / sum : 0;

				}

			}

		}

		geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( si, 4 ) );
		geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( sw, 4 ) );
		geo.computeBoundingSphere();
		geo.computeBoundingBox();
		return geo;

	}

}

function distToSegment( p, a, b ) {

	_v2.subVectors( b, a );
	const l2 = _v2.lengthSq();
	let t = l2 > 0 ? _v3.subVectors( p, a ).dot( _v2 ) / l2 : 0;
	t = Math.max( 0, Math.min( 1, t ) );
	_v3.copy( a ).addScaledVector( _v2, t );
	return p.distanceTo( _v3 );

}

// ---------------------------------------------------------------------------------------------
// Skeleton

function boneBasis( dir, forward ) {

	const Y = dir.clone().normalize();
	const Z = forward.clone().sub( Y.clone().multiplyScalar( forward.dot( Y ) ) );
	if ( Z.lengthSq() < 1e-6 ) Z.set( 0, 0, 1 ).sub( Y.clone().multiplyScalar( Y.z ) );
	if ( Z.lengthSq() < 1e-6 ) Z.set( 1, 0, 0 );
	Z.normalize();
	const X = new THREE.Vector3().crossVectors( Y, Z );
	return new THREE.Matrix4().makeBasis( X, Y, Z );

}

// Joint layout for a ~1.6 m humanoid (character space, metres). Scaled by spec.scale.
function jointLayout( s, p, spec ) {

	const J = {};
	const put = ( name, x, y, z ) => J[ name ] = new THREE.Vector3( x * s, y * s, z * s );
	put( 'hips', 0, 0.93, 0 );
	put( 'spine', 0, 1.02, 0.005 );
	put( 'chest', 0, 1.15, 0.01 );
	put( 'neck', 0, 1.37, 0 );
	put( 'head', 0, 1.44, 0.005 );
	put( 'headTop', 0, 1.70, 0 );
	const sh = p.shoulderWidth, arm = p.armLength;
	for ( const side of [ 'L', 'R' ] ) {

		const sg = side === 'L' ? - 1 : 1;
		put( 'clavicle' + side, sg * 0.025, 1.335, 0 );
		put( 'upperArm' + side, sg * sh, 1.33, 0 );
		put( 'forearm' + side, sg * ( sh + 0.025 ), 1.33 - arm * 0.47, - 0.01 );
		put( 'hand' + side, sg * ( sh + 0.045 ), 1.33 - arm * 0.92, 0.01 );
		put( 'handEnd' + side, sg * ( sh + 0.05 ), 1.33 - arm * 1.2, 0.02 );
		put( 'upperLeg' + side, sg * p.hipWidth, 0.90, 0 );
		put( 'lowerLeg' + side, sg * ( p.hipWidth + 0.01 ), 0.49, 0.008 );
		put( 'foot' + side, sg * ( p.hipWidth + 0.015 ), 0.085, - 0.015 );
		put( 'toe' + side, sg * ( p.hipWidth + 0.015 ), 0.02, 0.11 );
		put( 'toeEnd' + side, sg * ( p.hipWidth + 0.015 ), 0.0, 0.2 );

	}

	if ( spec.tail ) {

		for ( let i = 0; i <= spec.tail.segments; i ++ ) put( 'tail' + i, 0, 0.90 - i * 0.012, - 0.11 - i * spec.tail.segLen );

	}

	return J;

}

const BONE_TREE = [
	// [ name, parent, childJoint (for direction), radius ]
	[ 'hips', null, 'spine', 0.11 ],
	[ 'spine', 'hips', 'chest', 0.11 ],
	[ 'chest', 'spine', 'neck', 0.13 ],
	[ 'neck', 'chest', 'head', 0.05 ],
	[ 'head', 'neck', 'headTop', 0.14 ],
];
for ( const side of [ 'L', 'R' ] ) {

	BONE_TREE.push(
		[ 'clavicle' + side, 'chest', 'upperArm' + side, 0.06 ],
		[ 'upperArm' + side, 'clavicle' + side, 'forearm' + side, 0.045 ],
		[ 'forearm' + side, 'upperArm' + side, 'hand' + side, 0.038 ],
		[ 'hand' + side, 'forearm' + side, 'handEnd' + side, 0.035 ],
		[ 'upperLeg' + side, 'hips', 'lowerLeg' + side, 0.075 ],
		[ 'lowerLeg' + side, 'upperLeg' + side, 'foot' + side, 0.055 ],
		[ 'foot' + side, 'lowerLeg' + side, 'toe' + side, 0.045 ],
		[ 'toe' + side, 'foot' + side, 'toeEnd' + side, 0.04 ],
	);

}

function buildSkeleton( J, spec ) {

	const bones = [], byName = {}, boneInfo = {};
	const tree = BONE_TREE.slice();
	if ( spec.tail ) {

		for ( let i = 0; i < spec.tail.segments; i ++ ) tree.push( [ 'tail' + i, i === 0 ? 'hips' : 'tail' + ( i - 1 ), 'tail' + ( i + 1 ), spec.tail.radius ] );

	}

	const worldMats = {};
	for ( const [ name, parent, child, radius ] of tree ) {

		const head = J[ name ], tail = J[ child ];
		const dir = tail.clone().sub( head );
		const basis = boneBasis( dir, new THREE.Vector3( 0, 0, 1 ) );
		const world = basis.clone().setPosition( head );
		worldMats[ name ] = world;
		const bone = new THREE.Bone();
		bone.name = name;
		if ( parent ) {

			_m.copy( worldMats[ parent ] ).invert().multiply( world );
			_m.decompose( bone.position, bone.quaternion, bone.scale );
			byName[ parent ].add( bone );

		} else {

			world.decompose( bone.position, bone.quaternion, bone.scale );

		}

		bone.userData.bind = bone.quaternion.clone();
		bone.userData.bindPos = bone.position.clone();
		bone.userData.length = dir.length();
		bones.push( bone );
		byName[ name ] = bone;
		boneInfo[ name ] = { index: bones.length - 1, head: head.clone(), tail: tail.clone(), radius: radius * spec.scale, bone };

	}

	return { bones, byName, boneInfo };

}

// ---------------------------------------------------------------------------------------------
// Body construction

const smooth = ( a, b, t ) => a + ( b - a ) * ( t * t * ( 3 - 2 * t ) );
// Interpolate a radius keyframe list [[t, value]...]
function keyed( keys ) {

	return ( t ) => {

		if ( t <= keys[ 0 ][ 0 ] ) return keys[ 0 ][ 1 ];
		for ( let i = 1; i < keys.length; i ++ ) {

			if ( t <= keys[ i ][ 0 ] ) {

				const [ t0, v0 ] = keys[ i - 1 ], [ t1, v1 ] = keys[ i ];
				return smooth( v0, v1, ( t - t0 ) / ( t1 - t0 ) );

			}

		}

		return keys[ keys.length - 1 ][ 1 ];

	};

}

function pathLine( a, b, n ) {

	const out = [];
	for ( let i = 0; i <= n; i ++ ) out.push( a.clone().lerp( b, i / n ) );
	return out;

}

function pathBezier( a, c, b, n ) {

	const out = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n;
		out.push( new THREE.Vector3(
			( 1 - t ) * ( 1 - t ) * a.x + 2 * ( 1 - t ) * t * c.x + t * t * b.x,
			( 1 - t ) * ( 1 - t ) * a.y + 2 * ( 1 - t ) * t * c.y + t * t * b.y,
			( 1 - t ) * ( 1 - t ) * a.z + 2 * ( 1 - t ) * t * c.z + t * t * b.z,
		) );

	}

	return out;

}

// rounded end profile multiplier: full radius in the middle, spherical taper at the ends
const roundEnd = ( t, startR, endR ) => {

	let m = 1;
	if ( startR > 0 && t < startR ) m *= Math.sqrt( Math.max( 0, 1 - Math.pow( 1 - t / startR, 2 ) ) );
	if ( endR > 0 && t > 1 - endR ) m *= Math.sqrt( Math.max( 0, 1 - Math.pow( ( t - ( 1 - endR ) ) / endR, 2 ) ) );
	return Math.max( m, 0.02 );

};

export class Rig {

	constructor( spec, atlas ) {

		this.spec = spec;
		const s = spec.scale;
		this.J = jointLayout( s, spec.proportions, spec );
		const { bones, byName, boneInfo } = buildSkeleton( this.J, spec );
		this.bones = bones;
		this.byName = byName;
		this.boneInfo = boneInfo;

		const b = new SkinnedBuilder();
		this.builder = b;
		this.buildBody( b, spec );
		this.buildClothes( b, spec );
		this.buildHead( b, spec );
		this.buildHair( b, spec );
		if ( spec.tail ) this.buildTail( b, spec );
		if ( spec.catEars ) this.buildCatEars( b, spec );
		this.geometry = b.build( this );
		this.faceGeometry = this.buildFacePatch( spec );

		this.material = new AnimeMaterial( { map: atlas, shadowTint: spec.shadowTint, rim: spec.rim, sway: true } );
		this.outlineMaterial = makeOutlineMaterial( spec.outlineColor, 0.0045 * s );

	}

	// ---- body -----------------------------------------------------------------------------
	buildBody( b, spec ) {

		const J = this.J, s = spec.scale, P = spec.proportions;
		const skin = new THREE.Color( spec.skin );
		const skinCell = spec.skinCell || 'skin';

		// torso + neck
		b.beginPart( [ 'hips', 'spine', 'chest', 'neck', 'upperLegL', 'upperLegR' ], 1.0 );
		const torsoPath = pathLine( new THREE.Vector3( 0, 0.84 * s, 0 ), new THREE.Vector3( 0, 1.40 * s, 0 ), 12 );
		const rxK = keyed( [ [ 0, 0.155 ], [ 0.12, 0.165 ], [ 0.35, 0.135 ], [ 0.62, 0.15 ], [ 0.85, 0.185 ], [ 0.95, 0.18 ], [ 1, 0.1 ] ] );
		const rzK = keyed( [ [ 0, 0.11 ], [ 0.35, 0.095 ], [ 0.62, 0.105 ], [ 0.85, 0.11 ], [ 1, 0.07 ] ] );
		const rzBK = keyed( [ [ 0, 0.115 ], [ 0.3, 0.1 ], [ 0.7, 0.11 ], [ 1, 0.07 ] ] );
		b.tube( {
			path: torsoPath, segs: 20, cell: skinCell, color: skin, capEnd: true,
			profile: ( t ) => ( { rx: rxK( t ) * s * P.build, rz: rzK( t ) * s * P.build, rzBack: rzBK( t ) * s * P.build } ),
		} );
		b.tube( {
			path: pathLine( new THREE.Vector3( 0, 1.33 * s, 0.005 * s ), new THREE.Vector3( 0, 1.49 * s, 0.01 * s ), 3 ),
			segs: 12, cell: skinCell, color: skin,
			profile: () => ( { rx: 0.052 * s, rz: 0.05 * s } ),
		} );

		for ( const side of [ 'L', 'R' ] ) {

			const sg = side === 'L' ? - 1 : 1;
			// arm
			b.beginPart( [ 'clavicle' + side, 'upperArm' + side, 'forearm' + side, 'hand' + side ], 1.1 );
			const sh = J[ 'upperArm' + side ], el = J[ 'forearm' + side ], wr = J[ 'hand' + side ], he = J[ 'handEnd' + side ];
			const shoulderTop = sh.clone().add( new THREE.Vector3( sg * 0.01 * s, 0.045 * s, 0 ) );
			const armPath = [ shoulderTop, ...pathLine( sh, el, 5 ).slice( 1 ), ...pathLine( el, wr, 5 ).slice( 1 ) ];
			const armR = keyed( [ [ 0, 0.055 ], [ 0.1, 0.05 ], [ 0.45, 0.04 ], [ 0.52, 0.042 ], [ 0.75, 0.036 ], [ 1, 0.028 ] ] );
			b.tube( {
				path: armPath, segs: 12, cell: skinCell, color: skin, capStart: true,
				profile: ( t ) => ( { rx: armR( t ) * s * P.limb, rz: armR( t ) * s * P.limb * 0.95 } ),
			} );
			// hand: flattened mitten with a rounded tip
			const handPath = [ ...pathLine( wr, he, 6 ) ];
			b.tube( {
				path: handPath, segs: 12, cell: skinCell, color: skin, capEnd: true,
				profile: ( t ) => {

					const w = keyed( [ [ 0, 0.028 ], [ 0.25, 0.043 ], [ 0.6, 0.044 ], [ 1, 0.03 ] ] )( t );
					const m = roundEnd( t, 0, 0.3 );
					return { rx: w * s * m, rz: ( 0.016 + 0.006 * ( 1 - t ) ) * s * m, oz: 0.004 * s };

				},
			} );
			// thumb
			const thumbRoot = wr.clone().add( new THREE.Vector3( sg * 0.02 * s, - 0.03 * s, 0.015 * s ) );
			const thumbTip = thumbRoot.clone().add( new THREE.Vector3( sg * 0.02 * s, - 0.04 * s, 0.025 * s ) );
			b.tube( {
				path: pathLine( thumbRoot, thumbTip, 4 ), segs: 8, cell: skinCell, color: skin, capEnd: true, capStart: true,
				profile: ( t ) => ( { rx: 0.011 * s * roundEnd( t, 0.3, 0.4 ), rz: 0.011 * s * roundEnd( t, 0.3, 0.4 ) } ),
			} );

			// leg
			b.beginPart( [ 'hips', 'upperLeg' + side, 'lowerLeg' + side, 'foot' + side ], 1.0 );
			const hp = J[ 'upperLeg' + side ], kn = J[ 'lowerLeg' + side ], an = J[ 'foot' + side ];
			const legPath = [ hp.clone().add( new THREE.Vector3( 0, 0.03 * s, 0 ) ), ...pathLine( hp, kn, 5 ).slice( 1 ), ...pathLine( kn, an, 5 ).slice( 1 ) ];
			const legR = keyed( [ [ 0, 0.08 ], [ 0.1, 0.082 ], [ 0.45, 0.062 ], [ 0.52, 0.06 ], [ 0.8, 0.05 ], [ 1, 0.038 ] ] );
			b.tube( {
				path: legPath, segs: 14, cell: skinCell, color: skin,
				profile: ( t ) => ( { rx: legR( t ) * s * P.limb, rz: legR( t ) * s * P.limb * 1.05 } ),
			} );

			// foot (bare or shoe)
			const shoe = spec.shoes;
			b.beginPart( [ 'foot' + side, 'toe' + side, 'lowerLeg' + side ], 0.9 );
			const heel = new THREE.Vector3( an.x, ( shoe ? 0.0 : 0.005 ) * s, - 0.06 * s );
			const toe = new THREE.Vector3( an.x, ( shoe ? 0.0 : 0.005 ) * s, 0.2 * s );
			const footPath = pathLine( heel, toe, 10 );
			const fw = keyed( [ [ 0, 0.038 ], [ 0.2, 0.046 ], [ 0.65, 0.05 ], [ 0.9, 0.046 ], [ 1, 0.03 ] ] );
			const fh = keyed( [ [ 0, 0.05 ], [ 0.15, 0.06 ], [ 0.4, 0.052 ], [ 0.7, 0.04 ], [ 1, 0.028 ] ] );
			const shoeCol = new THREE.Color( shoe ? shoe.color : spec.skin );
			b.tube( {
				path: footPath, segs: 14, forward: new THREE.Vector3( 0, 1, 0 ), cell: shoe ? shoe.cell : skinCell, color: shoeCol, capStart: true, capEnd: true,
				profile: ( t ) => {

					const m = roundEnd( t, 0.18, 0.22 );
					const k = shoe ? 1.18 : 1;
					return { rx: fw( t ) * s * m * k, rz: fh( t ) * s * m * k, oz: fh( t ) * s * m * k - ( shoe ? 0.004 : 0 ) * s };

				},
				colorFn: shoe ? ( t, a ) => ( Math.sin( a ) < - 0.3 ? _c.copy( shoeCol ).multiplyScalar( 0.75 ) : shoeCol ) : null,
			} );
			if ( shoe ) {

				// heel strap
				const strapCol = _c.copy( shoeCol ).multiplyScalar( 0.9 ).clone();
				const sa = new THREE.Vector3( an.x - 0.052 * s, 0.045 * s, - 0.03 * s ), sb = new THREE.Vector3( an.x + 0.052 * s, 0.045 * s, - 0.03 * s );
				const sm = new THREE.Vector3( an.x, 0.03 * s, - 0.085 * s );
				b.tube( {
					path: pathBezier( sa, sm, sb, 10 ), segs: 6, cell: 'flat', color: strapCol, forward: new THREE.Vector3( 0, 1, 0 ),
					profile: () => ( { rx: 0.007 * s, rz: 0.009 * s } ),
				} );

			}

		}

	}

	// ---- clothes ---------------------------------------------------------------------------
	buildClothes( b, spec ) {

		const s = spec.scale, J = this.J, P = spec.proportions;
		const C = spec.clothes;
		const ragged = C.ragged || 0;
		const noise = ( t, a, amp ) => 1 + amp * ( Math.sin( a * 7.3 ) * 0.5 + Math.sin( a * 3.1 + 1.7 ) * 0.5 ) * Math.max( 0, 1 - t * 6 );

		// shirt body: loose, falls from the shoulders, hem below the hips
		b.beginPart( [ 'hips', 'spine', 'chest', 'clavicleL', 'clavicleR', 'upperArmL', 'upperArmR' ], 1.4 );
		const shirtCol = new THREE.Color( C.shirtColor );
		const hemY = C.shirtHem * s;
		const shirtPath = [ ...pathLine( new THREE.Vector3( 0, hemY, 0 ), new THREE.Vector3( 0, 1.31 * s, 0 ), 10 ), ...pathLine( new THREE.Vector3( 0, 1.31 * s, 0 ), new THREE.Vector3( 0, 1.42 * s, 0 ), 8 ).slice( 1 ) ];
		const sw = C.shirtLoose;
		const tS = ( 1.31 - C.shirtHem ) / ( 1.42 - C.shirtHem ); // t at the shoulder line
		const srx = keyed( [ [ 0, 0.175 + sw ], [ 0.3, 0.17 + sw * 0.9 ], [ 0.66, 0.18 + sw * 0.8 ], [ tS - 0.04, 0.2 + sw * 0.5 ], [ tS, 0.205 + sw * 0.4 ], [ tS + 0.5 * ( 1 - tS ), 0.15 ], [ tS + 0.8 * ( 1 - tS ), 0.095 ], [ 1, 0.065 ] ] );
		const srz = keyed( [ [ 0, 0.13 + sw * 0.9 ], [ 0.4, 0.12 + sw * 0.7 ], [ tS, 0.125 + sw * 0.5 ], [ tS + 0.5 * ( 1 - tS ), 0.1 ], [ 1, 0.06 ] ] );
		b.tube( {
			path: shirtPath, segs: 24, cell: C.shirtCell, color: shirtCol, capEnd: true, uvRepeat: [ 3, 2 ],
			profile: ( t ) => ( { rx: srx( t ) * s * P.build, rz: srz( t ) * s * P.build, rzBack: ( srz( t ) + 0.006 ) * s * P.build } ),
			radialNoise: ( t, a ) => noise( t, a, 0.04 + ragged * 0.3 ),
			colorFn: ( t ) => ( t < 0.05 ? _c.copy( shirtCol ).multiplyScalar( 0.8 ).clone() : shirtCol ),
		} );
		// open flannel front panels / collar
		if ( C.collar ) {

			const cc = new THREE.Color( C.collarColor || C.shirtColor );
			b.tube( {
				path: [ new THREE.Vector3( 0, 1.39 * s, 0 ), new THREE.Vector3( 0, 1.43 * s, 0.0 ) ], segs: 18, cell: 'flat', color: cc,
				profile: ( t ) => ( { rx: ( 0.085 - t * 0.02 ) * s, rz: ( 0.075 - t * 0.02 ) * s, rzBack: ( 0.08 - t * 0.015 ) * s } ),
			} );

		}

		// sleeves
		for ( const side of [ 'L', 'R' ] ) {

			const sg = side === 'L' ? - 1 : 1;
			b.beginPart( [ 'clavicle' + side, 'upperArm' + side, 'forearm' + side ], 1.3 );
			const sh = J[ 'upperArm' + side ], el = J[ 'forearm' + side ], wr = J[ 'hand' + side ];
			const end = sh.clone().lerp( C.sleeveLength > 0.5 ? wr : el, C.sleeveLength > 0.5 ? ( C.sleeveLength - 0.5 ) * 2 : C.sleeveLength * 2 );
			const top = sh.clone().add( new THREE.Vector3( - sg * 0.03 * s, 0.07 * s, 0 ) );
			const path = [ top, ...pathLine( sh.clone().add( new THREE.Vector3( sg * 0.012 * s, 0.03 * s, 0 ) ), end, 8 ) ];
			const sr = keyed( [ [ 0, 0.06 ], [ 0.12, 0.088 ], [ 0.6, 0.078 ], [ 1, 0.06 ] ] );
			const sleeveCol = C.sleeveColor ? new THREE.Color( C.sleeveColor ) : shirtCol;
			b.tube( {
				path, segs: 14, cell: C.sleeveCell || C.shirtCell, color: sleeveCol, capStart: true, uvRepeat: [ 1, 1 ],
				profile: ( t ) => ( { rx: sr( t ) * s * ( C.sleeveLoose || 1 ), rz: sr( t ) * s * ( C.sleeveLoose || 1 ) } ),
				radialNoise: ( t, a ) => 1 + ( 0.05 + ragged * 0.3 ) * Math.sin( a * 5 + 2 ) * Math.max( 0, t * 3 - 2 ),
			} );

		}

		// trousers: waistband block + two baggy legs
		b.beginPart( [ 'hips', 'spine', 'upperLegL', 'upperLegR' ], 1.3 );
		const pantCol = new THREE.Color( C.pantsColor );
		b.tube( {
			path: pathLine( new THREE.Vector3( 0, 0.78 * s, 0 ), new THREE.Vector3( 0, 1.0 * s, 0 ), 5 ), segs: 22, cell: C.pantsCell, color: pantCol, capEnd: true, uvRepeat: [ 3, 1 ],
			profile: ( t ) => ( { rx: ( 0.162 + 0.012 * t ) * s * P.build, rz: ( 0.112 + 0.008 * t ) * s * P.build, rzBack: ( 0.12 + 0.01 * t ) * s * P.build } ),
		} );
		for ( const side of [ 'L', 'R' ] ) {

			b.beginPart( [ 'hips', 'upperLeg' + side, 'lowerLeg' + side, 'foot' + side ], 1.2 );
			const hp = J[ 'upperLeg' + side ], kn = J[ 'lowerLeg' + side ], an = J[ 'foot' + side ];
			const bottom = kn.clone().lerp( an, C.pantsLength );
			const path = [ hp.clone().add( new THREE.Vector3( 0, 0.1 * s, 0 ) ), ...pathLine( hp, kn, 6 ).slice( 1 ), ...pathLine( kn, bottom, 6 ).slice( 1 ) ];
			const loose = C.pantsLoose;
			const pr = keyed( [ [ 0, 0.078 + loose * 0.4 ], [ 0.12, 0.095 + loose ], [ 0.45, 0.085 + loose ], [ 0.52, 0.082 + loose * 0.95 ], [ 0.85, 0.078 + loose * 1.1 ], [ 0.95, 0.085 + loose * 1.0 ], [ 1, 0.06 + loose * 0.6 ] ] );
			b.tube( {
				path, segs: 16, cell: C.pantsCell, color: pantCol, uvRepeat: [ 2, 3 ],
				profile: ( t ) => ( { rx: pr( t ) * s * P.limb, rz: pr( t ) * s * P.limb } ),
				radialNoise: ( t, a ) => 1 + ( 0.05 + ragged * 0.35 ) * Math.sin( a * 6 + t * 20 ) * Math.max( 0, t * 4 - 3 ),
				colorFn: ( t ) => ( t > 0.97 ? _c.copy( pantCol ).multiplyScalar( 0.75 ).clone() : pantCol ),
			} );

		}

	}

	// ---- head ------------------------------------------------------------------------------
	headShape( spec ) {

		const s = spec.scale, H = spec.head;
		const centre = new THREE.Vector3( 0, 1.575 * s, 0.01 * s );
		const r = 0.118 * s * H.size;
		// anime skull: wide cranium, cheeks tapering to a small chin, flat-ish face plane
		const deform = ( p, theta ) => {

			const ny = p.y / r; // -1 bottom .. 1 top
			const front = Math.max( 0, p.z / r );
			if ( ny < 0 ) {

				const k = Math.pow( - ny, 1.5 );
				p.x *= 1 - 0.34 * k * H.jaw;
				p.z *= 1 - 0.18 * k;
				p.z += 0.02 * r * k; // chin slightly forward
				p.y *= 1 + 0.06 * k;

			} else {

				p.x *= 1 + 0.04 * ny;
				p.z *= 1 - 0.03 * ny;

			}

			// flatten the face plane a touch
			p.z -= front * front * 0.05 * r;
			p.y *= 1.06;
			void theta;

		};

		return { centre, r, deform };

	}

	buildHead( b, spec ) {

		const skin = new THREE.Color( spec.skin );
		const { centre, r, deform } = this.headShape( spec );
		b.beginPart( [ 'head' ], 2 );
		b.sphere( { centre, radius: r, deform, cell: spec.skinCell || 'skin', color: skin, wSegs: 32, hSegs: 24 } );
		// ears
		const s = spec.scale;
		if ( ! spec.catEars ) {

			for ( const sg of [ - 1, 1 ] ) {

				const earC = centre.clone().add( new THREE.Vector3( sg * r * 0.96, - r * 0.05, - r * 0.05 ) );
				b.sphere( { centre: earC, radius: r * 0.2, cell: 'flat', color: skin, wSegs: 10, hSegs: 8, deform: ( p ) => {

					p.x *= 0.35;
					p.y *= 1.3;

				} } );

			}

		}

		// nose bump
		b.sphere( { centre: centre.clone().add( new THREE.Vector3( 0, - r * 0.12, r * 0.93 ) ), radius: r * 0.09, cell: 'flat', color: skin, wSegs: 8, hSegs: 6, deform: ( p ) => {

			p.y *= 1.4;
			p.z *= 0.8;

		} } );
		void s;

	}

	// Transparent front patch carrying the painted eyes/mouth. Separate mesh so it can swap textures.
	buildFacePatch( spec ) {

		const { centre, r, deform } = this.headShape( spec );
		const b = new SkinnedBuilder();
		b.beginPart( [ 'head' ], 2 );
		b.sphere( {
			centre, radius: r * 1.012, deform, color: new THREE.Color( 1, 1, 1 ), wSegs: 36, hSegs: 28,
			thetaStart: 0.95, thetaLength: 1.5, phiStart: - 0.9, phiLength: 1.8,
			uvFn: ( u, v, p ) => [ ( p.x - centre.x ) / ( r * 2.0 ) + 0.5, ( p.y - centre.y ) / ( r * 2.0 ) + 0.5 ],
		} );
		return b.build( this );

	}

	// ---- hair ------------------------------------------------------------------------------
	buildHair( b, spec ) {

		const s = spec.scale, H = spec.hair;
		const hairCol = new THREE.Color( H.color );
		const dark = hairCol.clone().multiplyScalar( 0.82 );
		const { centre, r, deform } = this.headShape( spec );
		b.beginPart( [ 'head' ], 3 );

		// scalp cap: slightly inflated skull top
		const capR = r * ( H.capScale || 1.05 );
		b.sphere( {
			centre: centre.clone().add( new THREE.Vector3( 0, 0.008 * s, - 0.006 * s ) ), radius: capR, cell: 'hair', color: hairCol, wSegs: 28, hSegs: 14,
			thetaStart: 0, thetaLength: H.capAngle, deform,
			colorFn: ( p ) => ( p.y > centre.y + r * 0.6 ? hairCol : dark ),
		} );

		// clumps
		const rng = mulberry( H.seed || 7 );
		const clump = ( root, dir, len, width, thick, curl, tipLift = 0 ) => {

			const mid = root.clone().addScaledVector( dir, len * 0.5 ).add( new THREE.Vector3( 0, len * 0.12, 0 ) );
			const end = root.clone().addScaledVector( dir, len ).add( new THREE.Vector3( 0, - len * curl, 0 ) );
			// bend toward the head so tips hug the skull
			const toHead = centre.clone().sub( end ).normalize();
			end.addScaledVector( toHead, len * 0.25 * ( 1 - tipLift ) );
			end.y += tipLift * len * 0.3;
			const path = pathBezier( root, mid, end, 7 );
			b.tube( {
				path, segs: 7, cell: 'hair', color: hairCol, capStart: true, capEnd: true, sway: true, forward: dir.clone().cross( new THREE.Vector3( 0, 1, 0 ) ).lengthSq() > 0.01 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 ),
				profile: ( t ) => {

					const w = Math.pow( 1 - t, 0.7 ) * Math.min( 1, t * 4 + 0.55 ) * ( 1 + Math.sin( t * Math.PI ) * 0.25 );
					return { rx: width * w, rz: thick * ( 0.6 + 0.4 * w ) * ( 1 - t * 0.6 ) };

				},
				colorFn: ( t ) => ( t > 0.75 ? dark : hairCol ),
			} );

		};

		const sph = ( theta, phi, rad ) => new THREE.Vector3( Math.sin( theta ) * Math.sin( phi ) * rad, Math.cos( theta ) * rad * 1.06, Math.sin( theta ) * Math.cos( phi ) * rad ).add( centre );
		// side/back hanging locks: wide flat shards that overlap
		for ( let layer = 0; layer < ( H.count > 0 ? H.layers : 0 ); layer ++ ) {

			const n = Math.max( 4, H.count - layer * 5 );
			for ( let i = 0; i < n; i ++ ) {

				const phi = H.frontGap + ( ( i + ( layer % 2 ) * 0.5 ) / n ) * ( Math.PI * 2 - H.frontGap * 2 ); // phi 0 = face
				const theta = 0.5 + layer * 0.4 + rng() * 0.06;
				const root = sph( theta, phi, capR * ( 0.96 + layer * 0.04 ) );
				const out = new THREE.Vector3( Math.sin( phi ), 0, Math.cos( phi ) );
				const side = Math.abs( Math.sin( phi ) );
				const len = ( H.length + ( side > 0.8 ? H.sideExtra : 0 ) ) * s * ( 0.85 + rng() * 0.3 );
				const dir = new THREE.Vector3( out.x * 0.3, - 1, out.z * 0.3 ).normalize();
				clump( root, dir, len, ( 0.055 + rng() * 0.02 ) * s, 0.011 * s, 0.1 + rng() * 0.15 );

			}

		}

		// fringe: swept shards across the brow, parted to one side, ending above the eyes
		for ( let i = 0; i < H.bangs; i ++ ) {

			const u = ( i / ( H.bangs - 1 ) ) * 2 - 1; // -1 .. 1 across the forehead
			const phi = u * H.bangSpread;
			const root = sph( 0.5 + Math.abs( u ) * 0.1, phi * 0.6, capR * 1.0 );
			const lean = H.bangLean;
			const dir = new THREE.Vector3( Math.sin( phi ) * 0.45 + lean, - 1, 0.5 ).normalize();
			const len = H.bangLength * s * ( 0.8 + rng() * 0.25 + ( 1 - Math.abs( u ) ) * 0.15 );
			clump( root, dir, len, ( 0.05 + rng() * 0.015 ) * s, 0.011 * s, - 0.05, 0 );

		}

		if ( H.length < 0.06 ) {

			// cropped hair: short fuzz all over the cap instead of hanging locks
			for ( let i = 0; i < 70; i ++ ) {

				const phi = rng() * Math.PI * 2, theta = rng() * ( H.capAngle - 0.1 );
				const root = sph( theta, phi, capR * 0.995 );
				const dir = new THREE.Vector3( Math.sin( phi ) * 0.5, - 0.3 + Math.cos( theta ) * 0.8, Math.cos( phi ) * 0.5 ).normalize();
				clump( root, dir, ( 0.02 + rng() * 0.015 ) * s, 0.016 * s, 0.009 * s, 0.0, 1 );

			}

		}

		// crown spikes / tufts
		for ( let i = 0; i < H.tufts; i ++ ) {

			const phi = Math.PI + ( rng() - 0.5 ) * 2.2;
			const root = sph( 0.25 + rng() * 0.25, phi, capR );
			const dir = new THREE.Vector3( Math.sin( phi ) * 0.6, 0.55, Math.cos( phi ) * 0.7 ).normalize();
			clump( root, dir, H.tuftLength * s, 0.03 * s, 0.014 * s, - 0.1, 1 );

		}

	}

	buildCatEars( b, spec ) {

		const s = spec.scale;
		const { centre, r } = this.headShape( spec );
		const hairCol = new THREE.Color( spec.hair.color );
		const inner = new THREE.Color( 0xf0b9b4 );
		const tipCol = new THREE.Color( 0x4d5f55 );
		b.beginPart( [ 'head' ], 3 );
		for ( const sg of [ - 1, 1 ] ) {

			const base = centre.clone().add( new THREE.Vector3( sg * r * 0.62, r * 0.82, - r * 0.08 ) );
			const tip = base.clone().add( new THREE.Vector3( sg * r * 0.35, r * 1.05, - r * 0.05 ) );
			const path = pathLine( base, tip, 6 );
			b.tube( {
				path, segs: 10, cell: 'hair', capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 0, 1 ),
				profile: ( t ) => ( { rx: 0.05 * s * ( 1 - t ) * ( 1 + t * 0.2 ), rz: 0.022 * s * ( 1 - t ) } ),
				colorFn: ( t, a ) => ( t > 0.8 ? tipCol : ( Math.sin( a ) > 0.25 && t < 0.75 ? inner : hairCol ) ),
			} );
			// earring hoops
			const n = sg < 0 ? 2 : 1;
			for ( let k = 0; k < n; k ++ ) {

				const c = base.clone().add( new THREE.Vector3( sg * r * ( 0.3 + k * 0.08 ), r * ( 0.3 + k * 0.22 ), 0 ) );
				b.beginPart( [ 'head' ], 3 );
				ring( b, c, 0.011 * s, 0.002 * s, new THREE.Vector3( 1, 0, 0 ), new THREE.Color( 0xd8dde2 ) );

			}

		}

	}

	buildTail( b, spec ) {

		const s = spec.scale, T = spec.tail;
		const col = new THREE.Color( T.color );
		const names = [];
		for ( let i = 0; i < T.segments; i ++ ) names.push( 'tail' + i );
		b.beginPart( names, 1.2 );
		const path = [];
		for ( let i = 0; i <= T.segments; i ++ ) path.push( this.J[ 'tail' + i ].clone() );
		b.tube( {
			path, segs: 10, cell: 'hair', color: col, capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 1, 0 ),
			profile: ( t ) => ( { rx: T.radius * s * ( 1 - t * 0.35 ) * roundEnd( t, 0.05, 0.12 ), rz: T.radius * s * ( 1 - t * 0.35 ) * roundEnd( t, 0.05, 0.12 ) } ),
		} );

	}

	// Build a renderable instance (its own skeleton so many can share the geometry).
	createInstance() {

		const root = new THREE.Group();
		const bones = this.bones.map( ( b ) => {

			const nb = new THREE.Bone();
			nb.name = b.name;
			nb.position.copy( b.position );
			nb.quaternion.copy( b.quaternion );
			nb.userData = { bind: b.userData.bind.clone(), bindPos: b.userData.bindPos.clone(), length: b.userData.length };
			return nb;

		} );
		const byName = {};
		this.bones.forEach( ( b, i ) => {

			byName[ b.name ] = bones[ i ];
			if ( b.parent && b.parent.isBone ) byName[ b.parent.name ].add( bones[ i ] );

		} );
		root.add( byName.hips );
		root.updateMatrixWorld( true );
		const skeleton = new THREE.Skeleton( bones );

		const mesh = new THREE.SkinnedMesh( this.geometry, this.material );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.bind( skeleton );
		root.add( mesh );

		const outline = new THREE.SkinnedMesh( this.geometry, this.outlineMaterial );
		outline.frustumCulled = false;
		outline.bind( skeleton );
		root.add( outline );

		const faceMat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false } );
		const face = new THREE.SkinnedMesh( this.faceGeometry, faceMat );
		face.frustumCulled = false;
		face.renderOrder = 2;
		face.bind( skeleton );
		root.add( face );

		return { root, bones, byName, skeleton, mesh, outline, face, faceMat, ankleH: this.J.footL.y };

	}

}

function ring( b, centre, R, r, axis, color ) {

	const path = [];
	const u = Math.abs( axis.x ) > 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
	const a1 = new THREE.Vector3().crossVectors( axis, u ).normalize(), a2 = new THREE.Vector3().crossVectors( axis, a1 ).normalize();
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12 * Math.PI * 2;
		path.push( centre.clone().addScaledVector( a1, Math.cos( t ) * R ).addScaledVector( a2, Math.sin( t ) * R ) );

	}

	b.tube( { path, segs: 6, cell: 'flat', color, forward: axis, profile: () => ( { rx: r, rz: r } ) } );

}

function mulberry( a ) {

	return () => {

		a |= 0;
		a = a + 0x6D2B79F5 | 0;
		let t = Math.imul( a ^ a >>> 15, 1 | a );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

