// /sculpt.html?webgl&anim=posed|idle|walk|run|air|kick&ang=0.5&dist=3.4&h=0.85&skel&orbit
import * as THREE from 'three/webgpu';
import { loadGlbKid } from '../characters/glbkid.js';
import { Animator, KID_STYLE } from '../characters/animator.js';

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
const dist = Number( params.get( 'dist' ) || 3.4 ), h = Number( params.get( 'h' ) || 0.85 ), ang = Number( params.get( 'ang' ) || 0.5 );
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


const kid = await loadGlbKid( '/models/catkid.glb', { outline: ! params.has( 'nooutline' ) } );
const sculpt = { instance: kid, root: kid.root, hipHeight: kid.hipHeight, J: kid.J, toPosed: () => {} };

scene.add( sculpt.root );
window.__sculpt = sculpt;
const anim = params.get( 'anim' ) || 'idle';
const style = { ...KID_STYLE, hipHeight: sculpt.hipHeight, stance: Math.abs( sculpt.J.hipL.x - sculpt.J.hipR.x ) / 2 + 0.01 };
const spec = { scale: 1, tail: { segments: 9, segLen: 0.08, radius: 0.05, lift: 0.3 } };
const animator = new Animator( sculpt.instance, spec, style, null, true );
if ( params.has( 'skel' ) ) scene.add( new THREE.SkeletonHelper( sculpt.root ) );
if ( anim === 'posed' ) sculpt.toPosed();

const st = { speed: 0, run: false, grounded: true, vy: 0, climbing: false, swimming: false, flip: 0, landed: 0, turnRate: 0, attack: - 1, attackKind: 'kick', hit: false, dead: false, lookAt: null, climbVy: 0 };
if ( anim === 'walk' ) st.speed = 3.2;
if ( anim === 'run' ) { st.speed = 7.4; st.run = true; }
if ( anim === 'air' ) { st.grounded = false; st.vy = 5; }
if ( anim === 'kick' ) st.attack = 0.35;

let t = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop( () => {

	const dt = Math.min( clock.getDelta(), 0.05 );
	t += dt;
	if ( params.has( 'orbit' ) ) sculpt.root.rotation.y = t * 0.6;
	if ( anim !== 'posed' && anim !== 'rest' ) animator.update( dt, st );
	if ( anim === 'rest' ) sculpt.root.updateMatrixWorld( true );
	renderer.render( scene, camera );
	window.__frames = ( window.__frames || 0 ) + 1;

} );
