import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, MToonMaterialLoaderPlugin } from '@pixiv/three-vrm';
import { MToonNodeMaterial } from '@pixiv/three-vrm/nodes';
import { SkinnedBuilder, keyed, pathLine, pathBezier, roundEnd } from './rig.js';
import { createCharacterAtlas } from './atlas.js';

// The playable character: a VRoid-made VRM 1.0 base (VRM Public License 1.0, modification allowed)
// restyled at load time into the kid from the model sheet — mint shaggy bob, cat ears with hoops,
// oversized yellow tee, baggy blue trousers, olive crocs and a long dark tail. Clothes that the base
// doesn't have are lofted procedurally and skinned to the VRM's own bones, so they animate with it.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const PAL = {
	hairLight: new THREE.Color( 0xdaf3e6 ),
	hairDark: new THREE.Color( 0x8fc3ab ),
	hairShade: new THREE.Color( 0x9fcdb7 ),
	tee: new THREE.Color( 0xf8f0a0 ),
	teeShade: new THREE.Color( 0xc9b86a ),
	pants: new THREE.Color( 0x4e6d95 ),
	pantsShade: new THREE.Color( 0x2f4461 ),
	croc: new THREE.Color( 0x7f8c3e ),
	crocShade: new THREE.Color( 0x4d5724 ),
	tail: new THREE.Color( 0x3a3a40 ),
	tailShade: new THREE.Color( 0x1e1e24 ),
	earInner: new THREE.Color( 0xf0b9b4 ),
	silver: new THREE.Color( 0xd9dee4 ),
};

export async function loadCatKid( url = '/models/VRM1_Constraint_Twist_Sample.vrm', { atlas = null } = {} ) {

	const loader = new GLTFLoader();
	loader.register( ( parser ) => new VRMLoaderPlugin( parser, {
		mtoonMaterialPlugin: new MToonMaterialLoaderPlugin( parser, { materialType: MToonNodeMaterial } ),
	} ) );
	const gltf = await loader.loadAsync( url );
	const vrm = gltf.userData.vrm;
	VRMUtils.removeUnnecessaryVertices( gltf.scene );
	VRMUtils.combineSkeletons( gltf.scene );
	vrm.scene.updateMatrixWorld( true );

	const meshes = {};
	vrm.scene.traverse( ( o ) => {

		if ( o.isMesh ) {

			o.castShadow = true;
			o.receiveShadow = true;
			o.frustumCulled = false;
			const mats = Array.isArray( o.material ) ? o.material : [ o.material ];
			for ( const m of mats ) {

				const key = m.name.replace( ' (Outline)', '' );
				( meshes[ key ] = meshes[ key ] || { mesh: o, mats: [] } ).mats.push( m );

			}

		}

	} );

	const kid = new CatKid( vrm, meshes, atlas || createCharacterAtlas() );
	return kid;

}

// Repaint a texture through a per-pixel function; keeps glTF conventions (flipY = false).
function repaint( tex, fn ) {

	const img = tex.image;
	const c = document.createElement( 'canvas' );
	c.width = img.width;
	c.height = img.height;
	const ctx = c.getContext( '2d' );
	ctx.drawImage( img, 0, 0 );
	const id = ctx.getImageData( 0, 0, c.width, c.height );
	const d = id.data;
	const out = new THREE.Color();
	for ( let i = 0; i < d.length; i += 4 ) {

		fn( d[ i ] / 255, d[ i + 1 ] / 255, d[ i + 2 ] / 255, d[ i + 3 ] / 255, out );
		d[ i ] = out.r * 255;
		d[ i + 1 ] = out.g * 255;
		d[ i + 2 ] = out.b * 255;

	}

	ctx.putImageData( id, 0, 0 );
	const t = new THREE.CanvasTexture( c );
	t.flipY = tex.flipY;
	t.colorSpace = tex.colorSpace;
	t.wrapS = tex.wrapS;
	t.wrapT = tex.wrapT;
	t.minFilter = tex.minFilter;
	t.magFilter = tex.magFilter;
	t.anisotropy = 8;
	t.needsUpdate = true;
	return t;

}

export class CatKid {

	constructor( vrm, meshes, atlas ) {

		this.vrm = vrm;
		this.root = vrm.scene;
		this.humanoid = vrm.humanoid;
		this.meshes = meshes;
		this.atlas = atlas;
		this.time = 0;
		this.extras = new THREE.Group();
		this.extras.name = 'extras';
		this.root.add( this.extras );
		this.bone = ( n ) => this.humanoid.getRawBoneNode( n );
		this.bonePos = ( n, out = new THREE.Vector3() ) => this.bone( n ).getWorldPosition( out );

		this.restyleHair();
		this.restyleClothes();
		this.buildPants();
		this.buildCrocs();
		this.buildEars();
		this.buildTail();
		this.buildPocky();
		this.setExpression( 'neutral' );

	}

	// ---- hair: mint recolour + bob cut ------------------------------------------------------
	restyleHair() {

		const recolor = ( tex ) => repaint( tex, ( r, g, b, a, out ) => {

			const lum = Math.pow( 0.299 * r + 0.587 * g + 0.114 * b, 0.8 );
			out.copy( PAL.hairDark ).lerp( PAL.hairLight, THREE.MathUtils.clamp( ( lum - 0.08 ) / 0.5, 0, 1 ) );

		} );
		const cache = new Map();
		const swap = ( tex ) => {

			if ( ! tex ) return null;
			if ( ! cache.has( tex ) ) cache.set( tex, recolor( tex ) );
			return cache.get( tex );

		};

		for ( const key of Object.keys( this.meshes ) ) {

			if ( ! /hair/i.test( key ) ) continue;
			for ( const m of this.meshes[ key ].mats ) {

				m.map = swap( m.map );
				if ( m.shadeMultiplyTexture ) m.shadeMultiplyTexture = swap( m.shadeMultiplyTexture );
				m.color.set( 0xffffff );
				m.shadeColorFactor.copy( PAL.hairShade );
				m.outlineColorFactor && m.outlineColorFactor.set( 0x4f7a68 );
				m.needsUpdate = true;

			}

		}

		// reshape the long hair into the sheet's shaggy bob: strands below the ear line are compressed
		// toward the head (so they keep their tapered tips), flicked outward at the ends and pinned to
		// the head bone so the now-unused hair physics chain can't drag them around
		const head = this.bonePos( 'head' );
		const earLine = head.y + 0.055;
		const jaw = head.y - 0.075;
		for ( const key of [ 'Hair_00_HAIR', 'HairBack_00_HAIR' ] ) {

			const e = this.meshes[ key ];
			if ( ! e ) continue;
			const mesh = e.mesh;
			const geo = mesh.geometry;
			const pos = geo.attributes.position;
			const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
			const headIndex = mesh.skeleton.bones.indexOf( this.bone( 'head' ) );
			let minY = Infinity;
			for ( let i = 0; i < pos.count; i ++ ) minY = Math.min( minY, pos.getY( i ) );
			for ( let i = 0; i < pos.count; i ++ ) {

				const x = pos.getX( i ), y = pos.getY( i ), z = pos.getZ( i );
				if ( y >= earLine ) continue;
				const t = ( earLine - y ) / ( earLine - minY ); // 0 at the ear line, 1 at the old tips
				// side locks framing the face hang a touch longer than the back
				const front = z > - 0.02 && Math.abs( x ) > 0.055;
				const len = ( earLine - jaw ) * ( front ? 1.3 : 1.1 ) * ( 1 + 0.15 * Math.sin( x * 140 + z * 60 ) );
				const ny = earLine - t * len;
				// shaggy flick: tips kick outward and slightly back
				const flick = Math.pow( t, 1.8 ) * 0.03;
				const nx = x + Math.sign( x ) * flick * ( front ? 0.5 : 1 );
				const nz = z - flick * 0.6 * ( z < - 0.02 ? 1 : 0 );
				pos.setXYZ( i, nx, ny, nz );
				if ( si && headIndex >= 0 ) {

					si.setXYZW( i, headIndex, 0, 0, 0 );
					sw.setXYZW( i, 1, 0, 0, 0 );

				}

			}

			pos.needsUpdate = true;
			if ( si ) si.needsUpdate = true;
			if ( sw ) sw.needsUpdate = true;
			geo.computeVertexNormals();
			geo.computeBoundingBox();

		}

	}

	// ---- clothes recolour --------------------------------------------------------------------
	restyleClothes() {

		const tops = this.meshes.Tops_01_CLOTH;
		if ( tops ) {

			for ( const m of tops.mats ) {

				m.color.copy( PAL.tee );
				m.shadeColorFactor.copy( PAL.teeShade );
				m.needsUpdate = true;

			}

		}

		// the base model's shorts and sneakers are hidden under the generated trousers and crocs
		for ( const key of [ 'Bottoms_01_CLOTH', 'Shoes_01_CLOTH' ] ) {

			const e = this.meshes[ key ];
			if ( ! e ) continue;
			const geo = e.mesh.geometry;
			const mats = Array.isArray( e.mesh.material ) ? e.mesh.material : [ e.mesh.material ];
			const hide = new Set( e.mats.map( ( m ) => mats.indexOf( m ) ) );
			if ( geo.groups.length ) {

				for ( const g of geo.groups ) if ( hide.has( g.materialIndex ) ) g.count = 0;

			} else {

				e.mesh.visible = false;

			}

		}

	}

	// Skinned accessory bound to a subset of the VRM's own bones.
	skinnedAccessory( builder, boneNames, material ) {

		const bones = boneNames.map( ( n ) => this.bone( n ) );
		const info = {};
		boneNames.forEach( ( n, i ) => {

			const head = this.bonePos( n );
			const child = bones[ i ].children.find( ( c ) => c.isBone ) || null;
			const tail = child ? child.getWorldPosition( new THREE.Vector3() ) : head.clone().add( new THREE.Vector3( 0, - 0.1, 0 ) );
			info[ n ] = { index: i, head, tail, radius: 0.07 };

		} );
		const geo = builder.build( { boneInfo: info } );
		const skeleton = new THREE.Skeleton( bones );
		const mesh = new THREE.SkinnedMesh( geo, material );
		mesh.frustumCulled = false;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		this.root.updateMatrixWorld( true );
		mesh.bind( skeleton, new THREE.Matrix4() );
		this.extras.add( mesh );
		return mesh;

	}

	toon( color, shade, { map = null, outline = 0.0025 } = {} ) {

		const m = new MToonNodeMaterial( { color, map } );
		m.shadeColorFactor = shade.clone();
		m.shadingToonyFactor = 0.9;
		m.shadingShiftFactor = - 0.05;
		m.outlineWidthMode = 'worldCoordinates';
		m.outlineWidthFactor = outline;
		m.outlineColorFactor = new THREE.Color( 0x2a2434 );
		return m;

	}

	// ---- baggy trousers ----------------------------------------------------------------------
	buildPants() {

		const b = new SkinnedBuilder();
		const hips = this.bonePos( 'hips' );
		const white = new THREE.Color( 1, 1, 1 );
		// waist block
		b.beginPart( [ 'hips', 'spine', 'leftUpperLeg', 'rightUpperLeg' ], 1.3 );
		const hipW = Math.abs( this.bonePos( 'leftUpperLeg' ).x - this.bonePos( 'rightUpperLeg' ).x ) / 2;
		const waistTop = hips.y + 0.0, waistBottom = hips.y - 0.14;
		b.tube( {
			path: pathLine( new THREE.Vector3( 0, waistBottom, hips.z ), new THREE.Vector3( 0, waistTop, hips.z ), 5 ), segs: 24, cell: 'denim', color: white, capEnd: true, uvRepeat: [ 3, 1 ],
			profile: ( t ) => ( { rx: hipW * 1.42 + 0.008, rz: hipW * 1.15 + 0.01, rzBack: hipW * 1.05 + 0.004 } ),
		} );
		for ( const side of [ 'left', 'right' ] ) {

			b.beginPart( [ 'hips', side + 'UpperLeg', side + 'LowerLeg', side + 'Foot' ], 1.2 );
			const hp = this.bonePos( side + 'UpperLeg' ), kn = this.bonePos( side + 'LowerLeg' ), an = this.bonePos( side + 'Foot' );
			const bottom = kn.clone().lerp( an, 0.92 );
			const path = [ hp.clone().add( new THREE.Vector3( 0, 0.02, 0 ) ), ...pathLine( hp, kn, 6 ).slice( 1 ), ...pathLine( kn, bottom, 6 ).slice( 1 ) ];
			const legR = Math.max( 0.085, hipW * 1.0 );
			// stays inside the tee above the hem (t < 0.2), then flares out baggy below it
			const pr = keyed( [ [ 0, legR * 0.98 ], [ 0.14, legR * 1.02 ], [ 0.26, legR * 1.2 ], [ 0.45, legR * 1.16 ], [ 0.52, legR * 1.12 ], [ 0.85, legR * 1.14 ], [ 0.95, legR * 1.18 ], [ 1, legR * 0.88 ] ] );
			b.tube( {
				path, segs: 18, cell: 'denim', color: white, uvRepeat: [ 2, 3 ],
				profile: ( t ) => ( { rx: pr( t ), rz: pr( t ) * 0.98 } ),
				radialNoise: ( t, a ) => 1 + 0.05 * Math.sin( a * 6 + t * 20 ) * Math.max( 0, t * 4 - 3 ) + 0.03 * Math.sin( a * 3 ) * t,
			} );

		}

		this.pants = this.skinnedAccessory( b, [ 'hips', 'spine', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot' ], this.toon( PAL.pants, PAL.pantsShade, { map: this.atlas } ) );

	}

	// ---- crocs -------------------------------------------------------------------------------
	buildCrocs() {

		const b = new SkinnedBuilder();
		const white = new THREE.Color( 1, 1, 1 );
		const dark = new THREE.Color( 0.72, 0.72, 0.72 );
		for ( const side of [ 'left', 'right' ] ) {

			const an = this.bonePos( side + 'Foot' );
			const toes = this.bone( side + 'Toes' ) ? this.bonePos( side + 'Toes' ) : an.clone().add( new THREE.Vector3( 0, - an.y * 0.8, 0.1 ) );
			const footLen = Math.max( 0.2, ( toes.z - an.z ) * 2.1 );
			b.beginPart( [ side + 'Foot', side + 'LowerLeg' ], 0.9 );
			const heel = new THREE.Vector3( an.x, 0.0, an.z - footLen * 0.3 );
			const toe = new THREE.Vector3( an.x, 0.0, an.z + footLen * 0.8 );
			const fw = keyed( [ [ 0, 0.04 ], [ 0.2, 0.05 ], [ 0.65, 0.054 ], [ 0.9, 0.05 ], [ 1, 0.032 ] ] );
			const fh = keyed( [ [ 0, 0.055 ], [ 0.15, 0.068 ], [ 0.4, 0.06 ], [ 0.7, 0.046 ], [ 1, 0.03 ] ] );
			b.tube( {
				path: pathLine( heel, toe, 12 ), segs: 16, forward: new THREE.Vector3( 0, 1, 0 ), cell: 'crocs', color: white, capStart: true, capEnd: true,
				profile: ( t ) => {

					const m = roundEnd( t, 0.18, 0.22 );
					return { rx: fw( t ) * m * 1.15, rz: fh( t ) * m * 1.15, oz: fh( t ) * m * 1.15 - 0.004 };

				},
			} );
			// heel strap
			const sa = new THREE.Vector3( an.x - 0.052, 0.05, an.z - 0.01 ), sb = new THREE.Vector3( an.x + 0.052, 0.05, an.z - 0.01 );
			const sm = new THREE.Vector3( an.x, 0.035, an.z - footLen * 0.42 );
			b.tube( {
				path: pathBezier( sa, sm, sb, 10 ), segs: 6, cell: 'flat', color: dark, forward: new THREE.Vector3( 0, 1, 0 ),
				profile: () => ( { rx: 0.007, rz: 0.01 } ),
			} );

		}

		this.crocs = this.skinnedAccessory( b, [ 'leftFoot', 'rightFoot', 'leftLowerLeg', 'rightLowerLeg' ], this.toon( PAL.croc, PAL.crocShade, { map: this.atlas, outline: 0.002 } ) );

	}

	// ---- cat ears (static children of the head bone) ------------------------------------------
	headTop() {

		let top = - Infinity;
		for ( const key of [ 'Hair_00_HAIR', 'HairBack_00_HAIR' ] ) {

			const e = this.meshes[ key ];
			if ( ! e ) continue;
			e.mesh.geometry.computeBoundingBox();
			top = Math.max( top, e.mesh.geometry.boundingBox.max.y );

		}

		return top;

	}

	buildEars() {

		const head = this.bone( 'head' );
		const headPos = this.bonePos( 'head' );
		const top = this.headTop();
		const hairCol = PAL.hairLight.clone().lerp( PAL.hairDark, 0.3 );
		const tipCol = new THREE.Color( 0x4d5f55 );
		head.updateWorldMatrix( true, false );
		const toLocal = new THREE.Matrix4().copy( head.matrixWorld ).invert();
		const parts = [
			{ b: new SkinnedBuilder(), color: hairCol, shade: PAL.hairShade, outline: 0.0025 },
			{ b: new SkinnedBuilder(), color: PAL.earInner, shade: new THREE.Color( 0xc98a8c ), outline: 0 },
			{ b: new SkinnedBuilder(), color: tipCol, shade: new THREE.Color( 0x2e3a33 ), outline: 0 },
			{ b: new SkinnedBuilder(), color: PAL.silver, shade: new THREE.Color( 0x7a8088 ), outline: 0 },
		];
		for ( const p of parts ) p.b.beginPart( [ 'head' ], 1 );
		const white = new THREE.Color( 1, 1, 1 );
		for ( const sg of [ - 1, 1 ] ) {

			const base = new THREE.Vector3( sg * 0.05, top - 0.04, headPos.z - 0.012 );
			const tip = base.clone().add( new THREE.Vector3( sg * 0.034, 0.1, - 0.012 ) );
			const path = pathLine( base, tip, 6 );
			// outer shell
			parts[ 0 ].b.tube( {
				path, segs: 12, capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 0, 1 ), cell: 'flat', color: white,
				profile: ( t ) => ( { rx: 0.043 * ( 1 - t ) * ( 1 + t * 0.25 ), rz: 0.02 * ( 1 - t ) } ),
			} );
			// inner ear: a flatter cone just in front of the shell
			parts[ 1 ].b.tube( {
				path: pathLine( base.clone().add( new THREE.Vector3( 0, 0.005, 0.012 ) ), tip.clone().lerp( base, 0.22 ).add( new THREE.Vector3( 0, 0, 0.01 ) ), 5 ), segs: 10, capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 0, 1 ), cell: 'flat', color: white,
				profile: ( t ) => ( { rx: 0.026 * ( 1 - t ), rz: 0.01 * ( 1 - t ), oz: 0.011 } ),
			} );
			// dark tip
			parts[ 2 ].b.tube( {
				path: pathLine( tip.clone().lerp( base, 0.2 ), tip.clone().add( new THREE.Vector3( 0, 0.002, 0 ) ), 3 ), segs: 10, capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 0, 1 ), cell: 'flat', color: white,
				profile: ( t ) => ( { rx: 0.0435 * 0.2 * ( 1 - t ) * ( 1 + 0.25 ) + 0.0005, rz: 0.0205 * 0.2 * ( 1 - t ) + 0.0005 } ),
			} );
			const n = sg < 0 ? 2 : 1;
			for ( let k = 0; k < n; k ++ ) {

				const c = base.clone().add( new THREE.Vector3( sg * ( 0.026 + k * 0.009 ), 0.03 + k * 0.025, 0 ) );
				ringTube( parts[ 3 ].b, c, 0.012, 0.0022, new THREE.Vector3( 1, 0, 0 ), white );

			}

		}

		const info = { head: { index: 0, head: headPos, tail: headPos.clone().add( new THREE.Vector3( 0, 0.2, 0 ) ), radius: 1 } };
		this.ears = new THREE.Group();
		for ( const p of parts ) {

			const geo = p.b.build( { boneInfo: info } );
			geo.applyMatrix4( toLocal );
			const mesh = new THREE.Mesh( geo, this.toon( p.color, p.shade, { outline: p.outline } ) );
			mesh.castShadow = true;
			this.ears.add( mesh );

		}

		head.add( this.ears );

	}

	// ---- tail: verlet chain of bones under the hips -------------------------------------------
	buildTail() {

		const hips = this.bone( 'hips' );
		const hipsPos = this.bonePos( 'hips' );
		const segs = 10, segLen = 0.065, radius = 0.024;
		const bones = [];
		const start = hipsPos.clone().add( new THREE.Vector3( 0, - 0.03, - 0.1 ) );
		let parent = hips;
		hips.updateWorldMatrix( true, false );
		const path = [ start.clone() ];
		for ( let i = 0; i < segs; i ++ ) {

			const bone = new THREE.Bone();
			bone.name = 'tail' + i;
			const world = start.clone().add( new THREE.Vector3( 0, - i * 0.015, - i * segLen ) );
			const next = start.clone().add( new THREE.Vector3( 0, - ( i + 1 ) * 0.015, - ( i + 1 ) * segLen ) );
			path.push( next.clone() );
			// bone basis: +Y along the segment
			const dir = next.clone().sub( world ).normalize();
			const z = new THREE.Vector3( 0, 1, 0 ).sub( dir.clone().multiplyScalar( dir.y ) ).normalize();
			const x = new THREE.Vector3().crossVectors( dir, z );
			_m.makeBasis( x, dir, z ).setPosition( world );
			parent.updateWorldMatrix( true, false );
			_m.premultiply( parent.matrixWorld.clone().invert() );
			_m.decompose( bone.position, bone.quaternion, bone.scale );
			parent.add( bone );
			bones.push( bone );
			parent = bone;

		}

		this.root.updateMatrixWorld( true );
		const b = new SkinnedBuilder();
		const info = {};
		b.beginPart( bones.map( ( x ) => x.name ), 1.2 );
		bones.forEach( ( bone, i ) => info[ bone.name ] = { index: i, head: path[ i ], tail: path[ i + 1 ], radius: radius * 1.5 } );
		const white = new THREE.Color( 1, 1, 1 );
		b.tube( {
			path, segs: 10, cell: 'hair', color: white, capStart: true, capEnd: true, forward: new THREE.Vector3( 0, 1, 0 ),
			profile: ( t ) => ( { rx: radius * ( 1 - t * 0.3 ) * roundEnd( t, 0.05, 0.12 ), rz: radius * ( 1 - t * 0.3 ) * roundEnd( t, 0.05, 0.12 ) } ),
		} );
		const geo = b.build( { boneInfo: info } );
		const mesh = new THREE.SkinnedMesh( geo, this.toon( PAL.tail, PAL.tailShade, { map: this.atlas, outline: 0.0018 } ) );
		mesh.frustumCulled = false;
		mesh.castShadow = true;
		mesh.bind( new THREE.Skeleton( bones ), new THREE.Matrix4() );
		this.extras.add( mesh );
		this.tail = bones.map( ( bone ) => ( { bone, pos: new THREE.Vector3(), prev: new THREE.Vector3(), len: segLen } ) );
		this.tailInit = false;
		this.tailMesh = mesh;

	}

	buildPocky() {

		const head = this.bone( 'head' );
		const g = new THREE.Group();
		const stick = new THREE.Mesh( new THREE.CylinderGeometry( 0.0038, 0.0038, 0.11, 6 ), this.toon( new THREE.Color( 0x4a2416 ), new THREE.Color( 0x2a1208 ), { outline: 0 } ) );
		stick.geometry.translate( 0, 0.055, 0 );
		stick.rotation.set( Math.PI / 2 + 0.35, 0, 0.3 );
		g.add( stick );
		// biscuit end
		const bisc = new THREE.Mesh( new THREE.CylinderGeometry( 0.0036, 0.0036, 0.03, 6 ), this.toon( new THREE.Color( 0xf2d39b ), new THREE.Color( 0xb8954f ), { outline: 0 } ) );
		bisc.geometry.translate( 0, 0.11 + 0.015, 0 );
		bisc.rotation.copy( stick.rotation );
		g.add( bisc );
		// mouth position relative to the head bone
		const headPos = this.bonePos( 'head' );
		let mouthY = headPos.y + 0.01, mouthZ = headPos.z + 0.1;
		const iris = this.meshes.EyeIris_00_EYE;
		if ( iris ) {

			iris.mesh.geometry.computeBoundingBox();
			const bb = iris.mesh.geometry.boundingBox;
			mouthY = bb.min.y - 0.045;
			mouthZ = bb.max.z - 0.004;

		}

		head.updateWorldMatrix( true, false );
		head.add( g );
		g.position.copy( head.worldToLocal( new THREE.Vector3( 0.012, mouthY, mouthZ ) ) );
		g.quaternion.copy( head.getWorldQuaternion( new THREE.Quaternion() ).invert() );
		g.visible = false;
		this.pocky = g;

	}

	// ---- expressions -----------------------------------------------------------------------
	setExpression( name, duration = 2 ) {

		this.expression = name;
		this.expressionT = name === 'neutral' ? 0 : duration;
		this.pocky.visible = name === 'flustered';

	}

	applyExpression( dt ) {

		const em = this.vrm.expressionManager;
		if ( ! em ) return;
		const t = this.time;
		const target = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0, aa: 0, oh: 0, blink: 0 };
		switch ( this.expression ) {

			case 'flustered': target.surprised = 0.5; target.happy = 0.35; target.oh = 0.25; break;
			case 'effort': target.angry = 0.55; target.aa = 0.25; break;
			case 'hurt': target.sad = 0.7; target.blink = 0.8; target.oh = 0.4; break;
			case 'happy': target.happy = 0.8; break;
			default: target.relaxed = 0.18 + Math.sin( t * 0.3 ) * 0.05; break;

		}

		// blinking
		this.blinkT -= dt;
		if ( this.blinkT < 0 ) {

			this.blink = 0.14;
			this.blinkT = 1.8 + Math.random() * 4;

		}

		if ( this.blink > 0 ) {

			this.blink -= dt;
			target.blink = Math.max( target.blink, Math.sin( Math.min( 1, this.blink / 0.14 ) * Math.PI ) );

		}

		const k = 1 - Math.exp( - dt * 14 );
		for ( const name in target ) {

			const cur = em.getValue( name ) || 0;
			em.setValue( name, cur + ( target[ name ] - cur ) * k );

		}

	}

	// ---- per-frame: tail physics + expressions + VRM spring bones ------------------------------
	update( dt, { moveF = 0, runF = 0, swimming = false, grounded = true } = {} ) {

		dt = Math.min( dt, 1 / 20 );
		this.time += dt;
		if ( this.blinkT === undefined ) {

			this.blinkT = 2;
			this.blink = 0;

		}

		if ( this.expressionT > 0 ) {

			this.expressionT -= dt;
			if ( this.expressionT <= 0 ) this.setExpression( 'neutral' );

		}

		this.applyExpression( dt );
		this.updateTail( dt, moveF, runF, swimming, grounded );
		this.vrm.update( dt );

	}

	updateTail( dt, moveF, runF, swimming, grounded ) {

		const T = this.tail;
		const anchor = T[ 0 ].bone.parent;
		anchor.updateWorldMatrix( true, false );
		_v.setFromMatrixPosition( anchor.matrixWorld );
		anchor.getWorldQuaternion( _q2 );
		const qRoot = this.root.getWorldQuaternion( new THREE.Quaternion() );
		// tail root sits a little behind/below the hips (character space → world)
		const rootOff = new THREE.Vector3( 0, - 0.03, - 0.1 ).applyQuaternion( qRoot );
		const A = _v.clone().add( rootOff );
		const grav = swimming ? 0.3 : 7;
		if ( ! this.tailInit ) {

			this.tailInit = true;
			const dir = new THREE.Vector3( 0, - 0.2, - 1 ).applyQuaternion( qRoot ).normalize();
			const c = A.clone();
			for ( const n of T ) {

				c.addScaledVector( dir, n.len );
				n.pos.copy( c );
				n.prev.copy( c );

			}

		}

		const wave = this.time * ( 2.5 + runF * 4 );
		const base = new THREE.Vector3( 0, - 0.12, - 1 ).applyQuaternion( qRoot );
		for ( let i = 0; i < T.length; i ++ ) {

			const n = T[ i ];
			_v2.copy( n.pos ).sub( n.prev ).multiplyScalar( 0.9 );
			n.prev.copy( n.pos );
			n.pos.add( _v2 );
			n.pos.y -= grav * dt * dt * ( 0.4 + i * 0.08 );
			const k = i / ( T.length - 1 );
			const lift = ( 0.9 + runF * 0.6 ) * k * k - 0.2 * k + Math.sin( wave - i * 0.6 ) * ( 0.15 + moveF * 0.2 ) * k + ( grounded ? 0 : 0.4 * k );
			const side = Math.sin( wave * 0.5 - i * 0.5 ) * 0.4 * k;
			const rest = new THREE.Vector3( side, lift, 0 ).applyQuaternion( qRoot ).add( base ).normalize();
			const target = ( i === 0 ? A : T[ i - 1 ].pos ).clone().addScaledVector( rest, n.len );
			n.pos.lerp( target, 1 - Math.exp( - dt * ( 7 - k * 3 ) ) );

		}

		for ( let iter = 0; iter < 3; iter ++ ) {

			for ( let i = 0; i < T.length; i ++ ) {

				const n = T[ i ];
				const from = i === 0 ? A : T[ i - 1 ].pos;
				_v2.subVectors( n.pos, from );
				const l = _v2.length() || 1e-4;
				n.pos.copy( from ).addScaledVector( _v2, n.len / l );

			}

		}

		let parentQ = _q2.clone();
		let from = A.clone();
		const up = new THREE.Vector3( 0, 1, 0 );
		for ( let i = 0; i < T.length; i ++ ) {

			const n = T[ i ];
			_v2.subVectors( n.pos, from ).normalize();
			const z = up.clone().addScaledVector( _v2, - up.dot( _v2 ) );
			if ( z.lengthSq() < 1e-6 ) z.set( 0, 0, 1 );
			z.normalize();
			const x = new THREE.Vector3().crossVectors( _v2, z );
			_m.makeBasis( x, _v2, z );
			_q.setFromRotationMatrix( _m );
			n.bone.quaternion.copy( parentQ.clone().invert().multiply( _q ) );
			if ( i === 0 ) n.bone.position.copy( anchor.worldToLocal( A.clone() ) );
			parentQ = _q.clone();
			from = n.pos;

		}

	}

}

function ringTube( b, centre, R, r, axis, color ) {

	const path = [];
	const u = Math.abs( axis.x ) > 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 );
	const a1 = new THREE.Vector3().crossVectors( axis, u ).normalize(), a2 = new THREE.Vector3().crossVectors( axis, a1 ).normalize();
	for ( let i = 0; i <= 12; i ++ ) {

		const t = i / 12 * Math.PI * 2;
		path.push( centre.clone().addScaledVector( a1, Math.cos( t ) * R ).addScaledVector( a2, Math.sin( t ) * R ) );

	}

	b.tube( { path, segs: 6, cell: 'flat', color, forward: axis, profile: () => ( { rx: r, rz: r } ) } );

}
