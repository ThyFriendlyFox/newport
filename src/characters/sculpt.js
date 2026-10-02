import * as THREE from 'three/webgpu';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { AnimeMaterial, makeOutlineMaterial } from './shading.js';

// Turns a static, posed sculpt (STL) into an animatable character:
//   1. a humanoid skeleton is placed on the posed mesh from a joint file (catkid-rig.json),
//   2. skin weights are solved from distance to the posed bone capsules,
//   3. the mesh is bound in that pose, then the skeleton is rotated into a canonical standing
//      rest (the Animator's convention: bone +Y toward the child, +Z forward),
//   4. parts are painted with vertex colours by bone/region since STL carries no colour.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();

const PAL = {
	skin: new THREE.Color( 0xf6dccb ),
	hair: new THREE.Color( 0xb6dcc6 ),
	hairDark: new THREE.Color( 0x8fbfa8 ),
	earInner: new THREE.Color( 0xf0b9b4 ),
	earTip: new THREE.Color( 0x4d5f55 ),
	tee: new THREE.Color( 0xf7ee98 ),
	pants: new THREE.Color( 0x4b6a92 ),
	croc: new THREE.Color( 0x7f8c3e ),
	tail: new THREE.Color( 0x3a3a40 ),
	silver: new THREE.Color( 0xdde2e8 ),
};

// bone tree: name → [ parentName, headJoint, tailJoint, radius, canonical rest direction (world), part ]
const TREE = [
	[ 'hips', null, 'hips', 'spine', 0.17, [ 0, 1, 0 ], 'pants' ],
	[ 'spine', 'hips', 'spine', 'chest', 0.16, [ 0, 1, 0 ], 'tee' ],
	[ 'chest', 'spine', 'chest', 'neck', 0.17, [ 0, 1, 0 ], 'tee' ],
	[ 'neck', 'chest', 'neck', 'head', 0.07, [ 0, 1, 0 ], 'skin' ],
	[ 'teeFront', 'spine', 'teeTop', 'teeHem', 0.13, [ 0, - 1, 0.12 ], 'tee' ],
	[ 'head', 'neck', 'head', 'headTop', 0.17, [ 0, 1, 0 ], 'head' ],
	[ 'clavicleL', 'chest', 'clavL', 'shoulderL', 0.08, [ 1, 0.15, 0 ], 'tee' ],
	[ 'upperArmL', 'clavicleL', 'shoulderL', 'elbowL', 0.1, [ 0.12, - 1, 0 ], 'sleeve' ],
	[ 'forearmL', 'upperArmL', 'elbowL', 'wristL', 0.05, [ 0.1, - 1, 0 ], 'skin' ],
	[ 'handL', 'forearmL', 'wristL', 'handL', 0.05, [ 0.1, - 1, 0.1 ], 'skin' ],
	[ 'clavicleR', 'chest', 'clavR', 'shoulderR', 0.08, [ - 1, 0.15, 0 ], 'tee' ],
	[ 'upperArmR', 'clavicleR', 'shoulderR', 'elbowR', 0.1, [ - 0.12, - 1, 0 ], 'sleeve' ],
	[ 'forearmR', 'upperArmR', 'elbowR', 'wristR', 0.05, [ - 0.1, - 1, 0 ], 'skin' ],
	[ 'handR', 'forearmR', 'wristR', 'handR', 0.05, [ - 0.1, - 1, 0.1 ], 'skin' ],
	[ 'upperLegL', 'hips', 'hipL', 'kneeL', 0.15, [ 0.02, - 1, 0 ], 'pants' ],
	[ 'lowerLegL', 'upperLegL', 'kneeL', 'ankleL', 0.1, [ 0, - 1, 0 ], 'pants' ],
	[ 'footL', 'lowerLegL', 'ankleL', 'toeL', 0.11, [ 0, - 0.45, 1 ], 'croc' ],
	[ 'toeL', 'footL', 'toeL', 'toeEndL', 0.05, [ 0, 0, 1 ], 'croc' ],
	[ 'upperLegR', 'hips', 'hipR', 'kneeR', 0.15, [ - 0.02, - 1, 0 ], 'pants' ],
	[ 'lowerLegR', 'upperLegR', 'kneeR', 'ankleR', 0.1, [ 0, - 1, 0 ], 'pants' ],
	[ 'footR', 'lowerLegR', 'ankleR', 'toeR', 0.11, [ 0, - 0.45, 1 ], 'croc' ],
	[ 'toeR', 'footR', 'toeR', 'toeEndR', 0.05, [ 0, 0, 1 ], 'croc' ],
];
const TAIL_SEGS = 6;
for ( let i = 0; i < TAIL_SEGS; i ++ ) TREE.push( [ 'tail' + i, i === 0 ? 'hips' : 'tail' + ( i - 1 ), 'tail' + i, 'tail' + ( i + 1 ), 0.05, [ 0, 0.25 + i * 0.12, - 1 ], 'tail' ] );

function basis( dir, forward ) {

	const Y = dir.clone().normalize();
	const Z = forward.clone().addScaledVector( Y, - forward.dot( Y ) );
	if ( Z.lengthSq() < 1e-6 ) Z.set( 0, 0, 1 ).addScaledVector( Y, - Y.z );
	if ( Z.lengthSq() < 1e-6 ) Z.set( 1, 0, 0 );
	Z.normalize();
	const X = new THREE.Vector3().crossVectors( Y, Z );
	return new THREE.Matrix4().makeBasis( X, Y, Z );

}

function distToSegment( p, a, b ) {

	_v2.subVectors( b, a );
	const l2 = _v2.lengthSq();
	let t = l2 > 0 ? _v3.subVectors( p, a ).dot( _v2 ) / l2 : 0;
	t = Math.max( 0, Math.min( 1, t ) );
	_v3.copy( a ).addScaledVector( _v2, t );
	return [ p.distanceTo( _v3 ), t ];

}

export async function loadSculpt( stlUrl, rigUrl, { outline = true } = {} ) {

	const [ geo, rigJson ] = await Promise.all( [ new STLLoader().loadAsync( stlUrl ), ( await fetch( rigUrl ) ).json() ] );
	geo.rotateX( - Math.PI / 2 ); // Z-up sculpt → Y-up
	geo.computeVertexNormals();
	const J = {};
	for ( const [ k, j ] of Object.entries( rigJson ) ) J[ k ] = new THREE.Vector3().fromArray( j.pos );
	// derived joints
	J.clavL = J.chest.clone().lerp( J.shoulderL, 0.25 );
	J.clavR = J.chest.clone().lerp( J.shoulderR, 0.25 );
	// the oversized tee drapes forward off the belly in the crouch; give it its own bone
	J.teeTop = J.spine.clone().lerp( J.chest, 0.5 ).add( new THREE.Vector3( 0, - 0.06, 0.1 ) );
	J.teeHem = new THREE.Vector3( J.teeTop.x, J.teeTop.y - 0.3, J.teeTop.z + 0.13 );
	J.toeEndL = J.toeL.clone().add( _v.subVectors( J.toeL, J.ankleL ).setY( 0 ).normalize().multiplyScalar( 0.07 ) );
	J.toeEndR = J.toeR.clone().add( _v.subVectors( J.toeR, J.ankleR ).setY( 0 ).normalize().multiplyScalar( 0.07 ) );
	return new SculptRig( geo, J, { outline } );

}

export class SculptRig {

	static debugLabels = false;

	constructor( geo, J, { outline } ) {

		this.J = J;
		this.geometry = geo;
		this.root = new THREE.Group();
		this.root.name = 'sculpt';
		this.buildSkeleton();
		this.skinAndPaint();
		this.bindMesh( outline );
		this.toRest();

	}

	// ---- skeleton in the posed configuration ------------------------------------------------
	// twist reference for each bone in the posed mesh: which way its "front" faces
	poseHint( name ) {

		const J = this.J;
		const perp = ( a, b, mid ) => {

			// component of (mid - a) perpendicular to the a→b line
			const v = b.clone().sub( a ), k = mid.clone().sub( a );
			return k.addScaledVector( v, - k.dot( v ) / Math.max( 1e-6, v.lengthSq() ) );

		};

		if ( /^(hips|spine|chest|teeFront)$/.test( name ) ) return new THREE.Vector3( 0, - 0.75, 1 ).normalize(); // belly faces down-forward in the crouch
		if ( name === 'neck' || name === 'head' ) return new THREE.Vector3( 0, - 0.35, 1 ).normalize();
		if ( name.startsWith( 'clavicle' ) ) return new THREE.Vector3( 0, - 0.5, 1 ).normalize();
		const safe = ( hint, dir, fallback ) => {

			// a hint nearly parallel to the bone gives an arbitrary twist; fall back to another axis
			const d = dir.clone().normalize();
			const h = hint.clone().addScaledVector( d, - hint.dot( d ) );
			return h.length() > 0.25 ? h.normalize() : fallback.clone().addScaledVector( d, - fallback.dot( d ) ).normalize();

		};

		for ( const side of [ 'L', 'R' ] ) {

			if ( name === 'upperLeg' + side || name === 'lowerLeg' + side ) {

				// knee bend direction when the leg is bent (knees bend forward); world forward otherwise
				const bend = perp( J[ 'hip' + side ], J[ 'ankle' + side ], J[ 'knee' + side ] );
				const dir = name.startsWith( 'upper' ) ? J[ 'knee' + side ].clone().sub( J[ 'hip' + side ] ) : J[ 'ankle' + side ].clone().sub( J[ 'knee' + side ] );
				const hint = bend.length() > 0.08 ? bend.normalize() : new THREE.Vector3( 0, 0, 1 );
				return safe( hint, dir, new THREE.Vector3( 0, 1, 0 ) );

			}

			if ( name === 'upperArm' + side || name === 'forearm' + side || name === 'hand' + side ) {

				const bend = perp( J[ 'shoulder' + side ], J[ 'wrist' + side ], J[ 'elbow' + side ] );
				const dir = name.startsWith( 'upper' ) ? J[ 'elbow' + side ].clone().sub( J[ 'shoulder' + side ] ) : J[ 'wrist' + side ].clone().sub( J[ 'elbow' + side ] );
				const hint = bend.length() > 0.05 ? bend.negate().normalize() : new THREE.Vector3( 0, 0, 1 ); // elbow points backward
				return safe( hint, dir, new THREE.Vector3( 0, 1, 0 ) );

			}

			if ( name === 'foot' + side || name === 'toe' + side ) return new THREE.Vector3( 0, 1, 0 );

		}

		if ( name.startsWith( 'tail' ) ) return new THREE.Vector3( 0, 1, 0 );
		return new THREE.Vector3( 0, 0, 1 );

	}

	restHint( name ) {

		if ( /^(foot|toe|tail)/.test( name ) ) return new THREE.Vector3( 0, 1, 0 );
		return new THREE.Vector3( 0, 0, 1 );

	}

	// ---- skeleton in the posed configuration ------------------------------------------------
	buildSkeleton() {

		const J = this.J;
		const bones = [], byName = {}, info = {};
		for ( const [ name, parent, headJ, tailJ, radius, restDir, part ] of TREE ) {

			const head = J[ headJ ], tail = J[ tailJ ];
			const dir = tail.clone().sub( head );
			const world = basis( dir, this.poseHint( name ) ).setPosition( head );
			const bone = new THREE.Bone();
			bone.name = name;
			if ( parent ) {

				_m.copy( byName[ parent ].matrixWorld ).invert().multiply( world );
				_m.decompose( bone.position, bone.quaternion, bone.scale );
				byName[ parent ].add( bone );

			} else {

				world.decompose( bone.position, bone.quaternion, bone.scale );
				this.root.add( bone );

			}

			bone.userData.posedQ = bone.quaternion.clone();
			bone.userData.posedPos = bone.position.clone();
			bone.updateMatrixWorld( true );
			bones.push( bone );
			byName[ name ] = bone;
			info[ name ] = { bone, head: head.clone(), tail: tail.clone(), radius, restDir: new THREE.Vector3().fromArray( restDir ), part, length: dir.length(), index: bones.length - 1 };

		}

		this.bones = bones;
		this.byName = byName;
		this.info = info;
		this.root.updateMatrixWorld( true );

	}

	// ---- skin weights + vertex colours ------------------------------------------------------
	// Bone ownership is decided geodesically (multi-source Dijkstra over the mesh edges from seed
	// vertices along each bone), so the fist resting near the hair or the hand next to the shoe
	// never grabs the wrong limb. Blending near joints only happens between a bone and its
	// hierarchy neighbours.
	labelVertices() {

		const geo = this.geometry;
		const pos = geo.attributes.position;
		const n = pos.count;
		// merge coincident vertices (STL is unindexed) so edges connect across triangles
		const key = new Map();
		const rep = new Int32Array( n );
		for ( let i = 0; i < n; i ++ ) {

			const k = ( Math.round( pos.getX( i ) * 1e4 ) ) + ',' + ( Math.round( pos.getY( i ) * 1e4 ) ) + ',' + ( Math.round( pos.getZ( i ) * 1e4 ) );
			let r = key.get( k );
			if ( r === undefined ) key.set( k, r = i );
			rep[ i ] = r;

		}

		const adj = new Map();
		const link = ( a, b ) => {

			if ( a === b ) return;
			let l = adj.get( a );
			if ( ! l ) adj.set( a, l = [] );
			l.push( b );

		};

		for ( let f = 0; f < n; f += 3 ) {

			const a = rep[ f ], b = rep[ f + 1 ], c = rep[ f + 2 ];
			link( a, b ); link( b, a ); link( b, c ); link( c, b ); link( a, c ); link( c, a );

		}

		const infos = Object.values( this.info );
		const dist = new Float32Array( n ).fill( Infinity );
		const label = new Int16Array( n ).fill( - 1 );
		// seeds: representative vertices close to the bone axis
		const heap = [];
		const push = ( d, v, b ) => {

			heap.push( [ d, v, b ] );
			let i = heap.length - 1;
			while ( i > 0 ) {

				const p = ( i - 1 ) >> 1;
				if ( heap[ p ][ 0 ] <= heap[ i ][ 0 ] ) break;
				[ heap[ p ], heap[ i ] ] = [ heap[ i ], heap[ p ] ];
				i = p;

			}

		};

		const pop = () => {

			const top = heap[ 0 ], last = heap.pop();
			if ( heap.length ) {

				heap[ 0 ] = last;
				let i = 0;
				for ( ;; ) {

					const l = i * 2 + 1, r = l + 1;
					let m = i;
					if ( l < heap.length && heap[ l ][ 0 ] < heap[ m ][ 0 ] ) m = l;
					if ( r < heap.length && heap[ r ][ 0 ] < heap[ m ][ 0 ] ) m = r;
					if ( m === i ) break;
					[ heap[ m ], heap[ i ] ] = [ heap[ i ], heap[ m ] ];
					i = m;

				}

			}

			return top;

		};

		// seeds: every vertex near a bone, costed by distance normalised to that bone's radius so a
		// thick trouser leg still belongs to its (thin) thigh bone rather than the nearby hips
		for ( let i = 0; i < n; i ++ ) {

			if ( rep[ i ] !== i ) continue;
			_v.fromBufferAttribute( pos, i );
			for ( const b of infos ) {

				const [ d ] = distToSegment( _v, b.head, b.tail );
				// the sculpt is one fused shell: the fist touches the hair and the hand rests by the
				// shoe, so extremities pay a premium and can't steal the neighbour's surface
				const premium = /^(hand|toe)/.test( b.bone.name ) ? 1.3 : 1;
				if ( d < b.radius * 1.8 ) push( ( d / b.radius ) * 0.08 * premium, i, b.index );

			}

		}

		while ( heap.length ) {

			const [ d, v, b ] = pop();
			if ( d >= dist[ v ] ) continue;
			dist[ v ] = d;
			label[ v ] = b;
			_v.fromBufferAttribute( pos, v );
			const nb = adj.get( v );
			if ( ! nb ) continue;
			for ( const u of nb ) {

				_v2.fromBufferAttribute( pos, u );
				const nd = d + _v.distanceTo( _v2 );
				if ( nd < dist[ u ] ) push( nd, u, b );

			}

		}

		for ( let i = 0; i < n; i ++ ) if ( rep[ i ] !== i ) label[ i ] = label[ rep[ i ] ];
		return label;

	}

	skinAndPaint() {

		const geo = this.geometry;
		const pos = geo.attributes.position, nrm = geo.attributes.normal;
		const n = pos.count;
		const label = this.labelVertices();
		const si = new Uint16Array( n * 4 ), sw = new Float32Array( n * 4 );
		const col = new Float32Array( n * 3 );
		const infos = Object.values( this.info );
		const J = this.J;
		const headC = J.head.clone().lerp( J.headTop, 0.45 );
		const faceDir = new THREE.Vector3( 0, - 0.35, 1 ).normalize(); // she looks down-forward in the pose
		const c = new THREE.Color();
		const counts = {};
		for ( let i = 0; i < n; i ++ ) {

			_v.fromBufferAttribute( pos, i );
			let b = infos[ label[ i ] ] || this.info.hips;
			// Weights: the owner dominates; its hierarchy neighbours (parent, children) share the
			// vertex with a gaussian falloff from their own axis so joints bend smoothly. Unrelated
			// bones never mix, which keeps the un-posing from smearing across limbs.
			const cand = [ b ];
			if ( b.bone.parent && b.bone.parent.isBone ) cand.push( this.info[ b.bone.parent.name ] );
			for ( const ch of b.bone.children ) if ( ch.isBone && cand.length < 4 ) cand.push( this.info[ ch.name ] );
			let sum = 0;
			const ws = cand.map( ( cb ) => {

				const [ d ] = distToSegment( _v, cb.head, cb.tail );
				const sigma = cb.radius * ( cb === b ? 1.0 : 0.4 );
				const w = Math.exp( - ( d * d ) / ( 2 * sigma * sigma ) ) * ( cb === b ? 1 : 0.7 ) + ( cb === b ? 1e-4 : 0 );
				sum += w;
				return w;

			} );
			for ( let k = 0; k < 4; k ++ ) {

				si[ i * 4 + k ] = cand[ k ] ? cand[ k ].index : 0;
				sw[ i * 4 + k ] = cand[ k ] ? ws[ k ] / sum : 0;

			}

			const [ , tOwn ] = distToSegment( _v, b.head, b.tail );

			// ---- paint ----
			let part = b.part;
			const t = tOwn;
			if ( part === 'head' ) {

				_v2.fromBufferAttribute( nrm, i );
				const rel = _v3.subVectors( _v, headC );
				const forwardness = rel.dot( faceDir ) / Math.max( 1e-3, rel.length() );
				const isEar = _v.y > J.headTop.y - 0.06 && Math.abs( _v.x ) > 0.045;
				if ( isEar ) part = _v2.dot( faceDir ) > 0.5 ? 'earInner' : ( _v.y > J.headTop.y + 0.03 ? 'earTip' : 'hair' );
				else if ( forwardness > 0.55 && _v2.dot( faceDir ) > 0.1 && _v.y < J.headTop.y - 0.1 ) part = 'skin';
				else part = 'hair';

			} else if ( part === 'sleeve' ) {

				part = t < 0.55 ? 'tee' : 'skin';

			} else if ( part === 'pants' && b.bone.name === 'hips' ) {

				part = _v.y > J.hips.y + 0.03 || ( _v.z > J.hips.z + 0.1 && _v.y > J.hips.y - 0.04 ) ? 'tee' : 'pants';

			} else if ( part === 'pants' && b.bone.name.startsWith( 'upperLeg' ) && t < 0.12 && _v.y > J.hips.y - 0.02 ) {

				part = 'tee';

			}

			counts[ part ] = ( counts[ part ] || 0 ) + 1;
			c.copy( PAL[ part ] || PAL.skin );
			if ( SculptRig.debugLabels ) c.setHSL( ( b.index * 0.381966 ) % 1, 0.85, 0.3 + ( b.index % 3 ) * 0.2 );
			if ( part === 'hair' && _v.y < J.head.y + 0.02 ) c.copy( PAL.hairDark );
			col[ i * 3 ] = c.r;
			col[ i * 3 + 1 ] = c.g;
			col[ i * 3 + 2 ] = c.b;

		}

		// The sculpt is one fused shell, so where the tee hem touches the thigh or the fist touches
		// the hair there are triangles bridging unrelated bones. Un-posing would stretch those into
		// sheets, so they are dropped (leaving small, hidden seams at the former contact points).
		const keep = [];
		let dropped = 0;
		for ( let f = 0; f < n; f += 3 ) {

			const a = infos[ label[ f ] ], bb = infos[ label[ f + 1 ] ], c2 = infos[ label[ f + 2 ] ];
			if ( a && bb && c2 && related( a.bone, bb.bone ) && related( a.bone, c2.bone ) && related( bb.bone, c2.bone ) ) keep.push( f, f + 1, f + 2 );
			else dropped ++;

		}

		geo.setIndex( keep );
		console.log( 'sculpt paint', JSON.stringify( counts ), 'dropped bridging tris', dropped );
		const perBone = {};
		for ( let i = 0; i < n; i ++ ) {

			const nm = infos[ label[ i ] ] ? infos[ label[ i ] ].bone.name : 'none';
			perBone[ nm ] = ( perBone[ nm ] || 0 ) + 1;

		}

		console.log( 'sculpt labels', JSON.stringify( perBone ) );
		geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( si, 4 ) );
		geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( sw, 4 ) );
		geo.setAttribute( 'color', new THREE.Float32BufferAttribute( col, 3 ) );
		geo.setAttribute( 'sway', new THREE.Float32BufferAttribute( new Float32Array( n ), 1 ) );

	}

	bindMesh( outline ) {

		this.skeleton = new THREE.Skeleton( this.bones );
		this.material = new AnimeMaterial( { shadowTint: 0xd08a90, rim: 0.3, sway: false } );
		this.mesh = new THREE.SkinnedMesh( this.geometry, this.material );
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = false;
		this.mesh.frustumCulled = false;
		this.root.updateMatrixWorld( true );
		this.mesh.bind( this.skeleton, new THREE.Matrix4() );
		this.root.add( this.mesh );
		if ( outline ) {

			this.outline = new THREE.SkinnedMesh( this.geometry, makeOutlineMaterial( 0x2b2234, 0.004 ) );
			this.outline.frustumCulled = false;
			this.outline.bind( this.skeleton, new THREE.Matrix4() );
			this.root.add( this.outline );

		}

	}

	// ---- rotate the bound skeleton into the canonical standing rest -------------------------
	toRest() {

		const worldQ = {};
		for ( const name of Object.keys( this.info ) ) {

			const b = this.info[ name ];
			const q = new THREE.Quaternion().setFromRotationMatrix( basis( b.restDir, this.restHint( name ) ) );
			worldQ[ name ] = q;
			const parent = b.bone.parent;
			const pq = parent && parent.isBone ? worldQ[ parent.name ] : new THREE.Quaternion();
			b.bone.quaternion.copy( pq.clone().invert().multiply( q ) );
			b.bone.userData.bind = b.bone.quaternion.clone();
			b.bone.userData.bindPos = b.bone.position.clone();
			b.bone.userData.length = b.length;

		}

		// hips: sit the standing figure on the ground
		const hips = this.byName.hips;
		const legLen = this.info.upperLegL.length + this.info.lowerLegL.length;
		const ankleH = this.info.footL.length * 0.45;
		const hipDrop = this.J.hips.y - ( this.J.hipL.y + this.J.hipR.y ) / 2;
		this.hipHeight = legLen + ankleH + hipDrop;
		hips.position.set( 0, this.hipHeight, 0 );
		this.ankleH = ankleH;
		this.root.updateMatrixWorld( true );
		for ( const bone of this.bones ) bone.userData.bindWorldQ = new THREE.Quaternion().setFromRotationMatrix( bone.matrixWorld );
		// standing height from the rest skeleton → scale the whole character to the sheet's 1.62 m
		const headTop = this.hipHeight + this.info.spine.length + this.info.chest.length + this.info.neck.length + this.info.head.length;
		this.standingHeight = headTop + this.info.hips.length;
		this.root.scale.setScalar( 1.62 / this.standingHeight );
		console.log( 'sculpt standing height', this.standingHeight.toFixed( 2 ), 'hip', this.hipHeight.toFixed( 2 ) );

	}

	// put the skeleton back into the sculpted pose (for inspection)
	toPosed() {

		for ( const bone of this.bones ) {

			bone.quaternion.copy( bone.userData.posedQ );
			bone.position.copy( bone.userData.posedPos );

		}

		this.root.updateMatrixWorld( true );

	}

	// Instance interface matching Rig.createInstance() for the Animator
	get instance() {

		return { root: this.root, bones: this.bones, byName: this.byName, skeleton: this.skeleton, mesh: this.mesh, outline: this.outline, face: null, faceMat: { map: null }, ankleH: this.ankleH };

	}

}

function related( a, b ) {

	return a === b || a.parent === b || b.parent === a || ( a.parent && a.parent === b.parent ) || ( a.parent && a.parent.parent === b ) || ( b.parent && b.parent.parent === a );

}
