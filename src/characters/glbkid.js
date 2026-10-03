import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimeMaterial, makeOutlineMaterial } from './shading.js';

// The retopologised cat kid (tools/retopo/build.py → public/models/catkid.glb): clean quad shells
// skinned to a humanoid armature whose bones use the Animator's convention (+Y along the bone,
// +Z forward). Materials are swapped for the anime toon shader with per-shell colours.

const _v = new THREE.Vector3();

export async function loadGlbKid( url = '/models/catkid.glb', { outline = true, textures = {} } = {} ) {

	const gltf = await new GLTFLoader().loadAsync( url );
	const root = new THREE.Group();
	root.name = 'kid';
	const scene = gltf.scene;
	scene.updateMatrixWorld( true );
	let skeleton = null;
	const meshes = [];
	scene.traverse( ( o ) => { if ( o.isSkinnedMesh ) meshes.push( o ); } );
	if ( ! meshes.length ) throw new Error( 'no skinned meshes in ' + url );
	skeleton = meshes[ 0 ].skeleton;
	const bones = skeleton.bones;
	const byName = {};
	for ( const b of bones ) {

		byName[ b.name ] = b;
		b.userData.bind = b.quaternion.clone();
		b.userData.bindPos = b.position.clone();
		const child = b.children.find( ( c ) => c.isBone );
		b.userData.length = child ? child.position.length() : 0.05;

	}

	// sanity: bones must run along +Y with +Z forward
	const ll = byName.lowerLegL;
	if ( ll ) {

		const d = ll.position.clone().normalize();
		console.log( 'glb kid bone axis check: child dir', d.toArray().map( ( v ) => v.toFixed( 2 ) ).join( ',' ), 'hips z→world', _v.set( 0, 0, 1 ).applyQuaternion( byName.hips.getWorldQuaternion( new THREE.Quaternion() ) ).toArray().map( ( v ) => v.toFixed( 2 ) ).join( ',' ) );

	}

	// bind consistency: inverse bind × rest world should be identity
	const m = new THREE.Matrix4();
	for ( const name of [ 'hips', 'chest', 'upperArmL', 'handL', 'upperLegL' ] ) {

		const i = bones.indexOf( byName[ name ] );
		if ( i < 0 ) continue;
		m.multiplyMatrices( byName[ name ].matrixWorld, skeleton.boneInverses[ i ] );
		const e = m.elements;
		console.log( 'bind check', name, 'offset', [ e[ 12 ], e[ 13 ], e[ 14 ] ].map( ( v ) => v.toFixed( 3 ) ).join( ',' ), 'diag', [ e[ 0 ], e[ 5 ], e[ 10 ] ].map( ( v ) => v.toFixed( 2 ) ).join( ',' ) );

	}

	const outlines = [];
	for ( const m of meshes ) {

		const src = m.material;
		const name = ( src.name || m.name ).toLowerCase();
		const color = src.color ? src.color.clone() : new THREE.Color( 1, 1, 1 );
		const mat = new AnimeMaterial( { shadowTint: name.includes( 'skin' ) || name.includes( 'face' ) ? 0xd08a90 : 0x9a8aa0, rim: 0.3, sway: false, map: textures[ name ] || src.map || null } );
		mat.vertexColors = false;
		mat.color.copy( color );
		if ( name.includes( 'hair' ) || name.includes( 'ear' ) ) mat.params.hair = true;
		if ( name.includes( 'tee' ) || name.includes( 'hair' ) ) mat.side = THREE.DoubleSide;
		m.material = mat;
		m.castShadow = true;
		m.receiveShadow = false;
		m.frustumCulled = false;
		if ( outline ) {

			const o = new THREE.SkinnedMesh( m.geometry, makeOutlineMaterial( 0x2b2234, name.includes( 'face' ) ? 0.0025 : 0.0045, color ) );
			o.bind( skeleton, m.bindMatrix );
			o.frustumCulled = false;
			m.add( o );
			outlines.push( o );

		}

	}

	root.add( scene );
	const hipsY = byName.hips.getWorldPosition( new THREE.Vector3() ).y;
	const ankleH = byName.footL.getWorldPosition( new THREE.Vector3() ).y;
	const J = { hipL: byName.upperLegL.getWorldPosition( new THREE.Vector3() ), hipR: byName.upperLegR.getWorldPosition( new THREE.Vector3() ) };
	return { root, bones, byName, skeleton, mesh: meshes[ 0 ], meshes, outline: outlines[ 0 ], face: null, faceMat: { map: null }, ankleH, hipHeight: hipsY, J };

}
