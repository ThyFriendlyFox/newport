// /vrm.html?webgl&dist=3.4&h=0.85&expr=flustered&orbit&pose=idle|t
import * as THREE from 'three/webgpu';
import { loadCatKid } from '../characters/catkid.js';

const params = new URLSearchParams( location.search );
const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( 1 );
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
document.body.appendChild( renderer.domElement );
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xdfe6ee );
const camera = new THREE.PerspectiveCamera( 32, innerWidth / innerHeight, 0.05, 100 );
const dist = Number( params.get( 'dist' ) || 3.4 );
const h = Number( params.get( 'h' ) || 0.85 );
const ang = Number( params.get( 'ang' ) || 0.45 );
camera.position.set( Math.sin( ang ) * dist, h + 0.3, Math.cos( ang ) * dist );
camera.lookAt( 0, h, 0 );
scene.add( new THREE.HemisphereLight( 0xdfe8ff, 0xb59a74, 0.8 ) );
const sun = new THREE.DirectionalLight( 0xfff1dc, 2.4 );
sun.position.set( 3, 6, 4 );
sun.castShadow = true;
sun.shadow.mapSize.set( 2048, 2048 );
Object.assign( sun.shadow.camera, { left: - 3, right: 3, top: 3, bottom: - 3, near: 1, far: 20 } );
sun.shadow.bias = - 0.0005;
sun.shadow.normalBias = 0.02;
scene.add( sun );
const ground = new THREE.Mesh( new THREE.PlaneGeometry( 20, 20 ), new THREE.MeshStandardMaterial( { color: 0xb8b0a4 } ) );
ground.rotation.x = - Math.PI / 2;
ground.receiveShadow = true;
scene.add( ground );

const kid = await loadCatKid( '/models/' + ( params.get( 'model' ) || 'VRM1_Constraint_Twist_Sample.vrm' ) );
scene.add( kid.root );
window.__kid = kid;
for ( const h of ( params.get( 'hide' ) || '' ).split( ',' ) ) {

	if ( h === 'pants' ) kid.pants.visible = false;
	if ( h === 'shirt' ) { const e = kid.meshes.Tops_01_CLOTH; for ( const g of e.mesh.geometry.groups ) g.count = 0; }
	if ( h === 'hair' ) { for ( const k of [ 'Hair_00_HAIR', 'HairBack_00_HAIR' ] ) kid.meshes[ k ].mesh.visible = false; }

}
if ( params.get( 'expr' ) ) kid.setExpression( params.get( 'expr' ), 1e9 );

const nb = ( n ) => kid.humanoid.getNormalizedBoneNode( n );
if ( ( params.get( 'pose' ) || 'idle' ) === 'idle' ) {

	nb( 'leftUpperArm' ).rotation.set( 0.05, 0, - 1.22 );
	nb( 'rightUpperArm' ).rotation.set( 0.05, 0, 1.22 );
	nb( 'leftLowerArm' ).rotation.set( 0, 0.35, - 0.12 );
	nb( 'rightLowerArm' ).rotation.set( 0, - 0.35, 0.12 );
	nb( 'leftHand' ).rotation.set( 0, 0, - 0.1 );
	nb( 'rightHand' ).rotation.set( 0, 0, 0.1 );
	nb( 'spine' ).rotation.set( 0.04, 0, 0 );
	nb( 'head' ).rotation.set( - 0.04, 0.18, - 0.08 );
	nb( 'leftUpperLeg' ).rotation.set( 0, 0, 0.05 );
	nb( 'rightUpperLeg' ).rotation.set( 0.0, 0, - 0.03 );

}

const clock = new THREE.Clock();
renderer.setAnimationLoop( () => {

	const dt = clock.getDelta();
	if ( params.has( 'orbit' ) ) kid.root.rotation.y += dt * 0.5;
	kid.update( dt, {} );
	renderer.render( scene, camera );
	window.__frames = ( window.__frames || 0 ) + 1;

} );
