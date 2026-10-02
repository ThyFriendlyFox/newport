// /stl.html?webgl&view=front|side|top|iso&file=catkid-base.stl
import * as THREE from 'three/webgpu';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
const params = new URLSearchParams( location.search );
const renderer = new THREE.WebGPURenderer( { antialias: true, forceWebGL: params.has( 'webgl' ) } );
renderer.setPixelRatio( 1 );
renderer.setSize( innerWidth, innerHeight );
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild( renderer.domElement );
await renderer.init();
const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xdfe6ee );
const geo = await new STLLoader().loadAsync( '/models/' + ( params.get( 'file' ) || 'catkid-base.stl' ) );
geo.computeVertexNormals();
geo.rotateX( - Math.PI / 2 ); // Z-up → Y-up
geo.computeBoundingBox();
const bb = geo.boundingBox, c = bb.getCenter( new THREE.Vector3() ), size = bb.getSize( new THREE.Vector3() );
const mesh = new THREE.Mesh( geo, new THREE.MeshStandardMaterial( { color: 0xcfc6bb, roughness: 0.75 } ) );
scene.add( mesh );
scene.add( new THREE.HemisphereLight( 0xffffff, 0x887766, 1.0 ) );
const sun = new THREE.DirectionalLight( 0xffffff, 2.0 );
sun.position.set( 2, 5, 3 );
scene.add( sun );
const grid = new THREE.GridHelper( 2, 20, 0x8899aa, 0xaabbcc );
grid.position.y = bb.min.y;
scene.add( grid );
const aspect = innerWidth / innerHeight;
const view = params.get( 'view' ) || 'iso';
const r = Math.max( size.x, size.y, size.z ) * 0.6;
const camera = new THREE.OrthographicCamera( - r * aspect, r * aspect, r, - r, 0.01, 100 );
const d = 10;
if ( view === 'front' ) camera.position.set( c.x, c.y, c.z + d );
else if ( view === 'back' ) camera.position.set( c.x, c.y, c.z - d );
else if ( view === 'side' ) camera.position.set( c.x + d, c.y, c.z );
else if ( view === 'top' ) camera.position.set( c.x, c.y + d, c.z + 0.001 );
else camera.position.set( c.x + d * 0.6, c.y + d * 0.4, c.z + d * 0.7 );
camera.lookAt( c );
console.log( 'bbox', bb.min.toArray().map( ( v ) => v.toFixed( 2 ) ), bb.max.toArray().map( ( v ) => v.toFixed( 2 ) ) );
renderer.setAnimationLoop( () => { renderer.render( scene, camera ); window.__frames = ( window.__frames || 0 ) + 1; } );
// joint overlay from catkid-rig.json
try {

	const rig = await ( await fetch( '/models/catkid-rig.json' ) ).json();
	const colors = { L: 0x2266ff, R: 0xff3322 };
	for ( const [ name, j ] of Object.entries( rig ) ) {

		const col = name.endsWith( 'L' ) ? colors.L : name.endsWith( 'R' ) ? colors.R : 0x22aa33;
		const s = new THREE.Mesh( new THREE.SphereGeometry( 0.025, 10, 8 ), new THREE.MeshBasicMaterial( { color: col, depthTest: false, transparent: true, opacity: 0.9 } ) );
		s.position.fromArray( j.pos );
		s.renderOrder = 10;
		scene.add( s );

	}

	mesh.material.transparent = true;
	mesh.material.opacity = 0.55;

} catch ( e ) { console.log( 'no rig json', e ); }
