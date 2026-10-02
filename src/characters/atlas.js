import * as THREE from 'three/webgpu';
import { createRng } from '../core/rng.js';

// One 1024² atlas shared by every character: a 4x4 grid of 256px cells, each a self-contained
// repeating pattern. Parts map their (u around, v along) UVs into a cell, so a whole character is
// one draw call. Cells carry 6px of padding so mip-mapping never bleeds between them.

export const CELL = {
	flat: [ 0, 0 ],
	flannel: [ 1, 0 ],
	denim: [ 2, 0 ],
	crocs: [ 3, 0 ],
	hair: [ 0, 1 ],
	cotton: [ 1, 1 ],
	deadSkin: [ 2, 1 ],
	tee: [ 3, 1 ],
	skin: [ 0, 2 ],
	sole: [ 1, 2 ],
	ragPants: [ 2, 2 ],
	iris: [ 3, 2 ],
};

const SIZE = 1024, C = 256, PAD = 6;

export function cellUV( name, u, v ) {

	const [ cx, cy ] = CELL[ name ];
	const inner = ( C - PAD * 2 ) / SIZE;
	return [ ( cx * C + PAD ) / SIZE + u * inner, 1 - ( ( cy * C + PAD ) / SIZE + v * inner ) ];

}

function drawCell( ctx, name, fn ) {

	const [ cx, cy ] = CELL[ name ];
	ctx.save();
	ctx.beginPath();
	ctx.rect( cx * C, cy * C, C, C );
	ctx.clip();
	ctx.translate( cx * C, cy * C );
	fn( ctx );
	ctx.restore();

}

export function createCharacterAtlas() {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = SIZE;
	const ctx = canvas.getContext( '2d' );
	const rng = createRng( 9001 );
	ctx.fillStyle = '#ffffff';
	ctx.fillRect( 0, 0, SIZE, SIZE );

	// --- flat white (vertex colour only) ---------------------------------------------------
	drawCell( ctx, 'flat', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );

	} );

	// --- skin: faint pores + warm gradient hint --------------------------------------------
	drawCell( ctx, 'skin', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 2500; i ++ ) {

			c.fillStyle = `rgba(200,150,140,${rng.range( 0.02, 0.07 )})`;
			c.fillRect( rng.next() * C, rng.next() * C, 1.5, 1.5 );

		}

	} );

	// --- desiccated zombie skin: cracks, mottling, dark veins -------------------------------
	drawCell( ctx, 'deadSkin', ( c ) => {

		c.fillStyle = '#f0ece6';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 70; i ++ ) {

			const g = c.createRadialGradient( rng.next() * C, rng.next() * C, 0, 0, 0, 0 );
			void g;
			c.fillStyle = `rgba(${rng.pick( [ '90,60,50', '60,45,40', '130,100,80', '70,80,60' ] )},${rng.range( 0.08, 0.25 )})`;
			c.beginPath();
			c.ellipse( rng.next() * C, rng.next() * C, rng.range( 6, 30 ), rng.range( 4, 18 ), rng.next() * 3, 0, Math.PI * 2 );
			c.fill();

		}

		c.strokeStyle = 'rgba(40,25,20,0.55)';
		c.lineWidth = 1.2;
		for ( let i = 0; i < 40; i ++ ) {

			let x = rng.next() * C, y = rng.next() * C;
			c.beginPath();
			c.moveTo( x, y );
			for ( let k = 0; k < 6; k ++ ) {

				x += rng.range( - 14, 14 );
				y += rng.range( - 14, 14 );
				c.lineTo( x, y );

			}

			c.stroke();

		}

		for ( let i = 0; i < 4000; i ++ ) {

			c.fillStyle = `rgba(60,40,35,${rng.range( 0.03, 0.12 )})`;
			c.fillRect( rng.next() * C, rng.next() * C, 1.5, 1.5 );

		}

	} );

	// --- flannel plaid (blue / grey / brown as in the model sheet) ---------------------------
	drawCell( ctx, 'flannel', ( c ) => {

		c.fillStyle = '#4a5a70';
		c.fillRect( 0, 0, C, C );
		const bands = [ [ 0, 28, '#6f7378' ], [ 28, 8, '#7a5c45' ], [ 36, 24, '#2f3a4c' ], [ 60, 4, '#b8b2a6' ] ];
		const period = 64;
		for ( let p = 0; p < C; p += period ) {

			for ( const [ o, w, col ] of bands ) {

				c.fillStyle = col;
				c.globalAlpha = 0.85;
				c.fillRect( p + o, 0, w, C );
				c.globalAlpha = 0.55;
				c.fillRect( 0, p + o, C, w );

			}

		}

		c.globalAlpha = 1;
		// weave texture
		for ( let y = 0; y < C; y += 2 ) {

			for ( let x = ( y / 2 ) % 2; x < C; x += 2 ) {

				c.fillStyle = 'rgba(0,0,0,0.12)';
				c.fillRect( x, y, 1, 1 );

			}

		}

		// tears and grime
		for ( let i = 0; i < 14; i ++ ) {

			c.fillStyle = `rgba(30,25,20,${rng.range( 0.15, 0.4 )})`;
			c.beginPath();
			c.ellipse( rng.next() * C, rng.next() * C, rng.range( 4, 22 ), rng.range( 3, 10 ), rng.next() * 3, 0, Math.PI * 2 );
			c.fill();

		}

	} );

	// --- denim weave (tinted by vertex colour) ----------------------------------------------
	drawCell( ctx, 'denim', ( c ) => {

		c.fillStyle = '#d6dde6';
		c.fillRect( 0, 0, C, C );
		for ( let y = 0; y < C; y += 2 ) {

			for ( let x = ( y / 2 ) % 2; x < C; x += 2 ) {

				c.fillStyle = rng.chance( 0.5 ) ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,50,0.16)';
				c.fillRect( x, y, 1, 1 );

			}

		}

		// faded knees / creases
		for ( let i = 0; i < 6; i ++ ) {

			c.fillStyle = `rgba(255,255,255,${rng.range( 0.05, 0.12 )})`;
			c.beginPath();
			c.ellipse( rng.next() * C, rng.next() * C, rng.range( 20, 50 ), rng.range( 8, 20 ), rng.next() * 3, 0, Math.PI * 2 );
			c.fill();

		}

	} );

	// --- ragged olive-grey trousers (zombie) -------------------------------------------------
	drawCell( ctx, 'ragPants', ( c ) => {

		c.fillStyle = '#4b4f45';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 5000; i ++ ) {

			c.fillStyle = `rgba(${rng.chance( 0.5 ) ? '20,20,15' : '120,120,100'},${rng.range( 0.03, 0.1 )})`;
			c.fillRect( rng.next() * C, rng.next() * C, 1.5, 1.5 );

		}

		for ( let i = 0; i < 12; i ++ ) {

			c.fillStyle = `rgba(25,22,18,${rng.range( 0.25, 0.5 )})`;
			c.beginPath();
			c.ellipse( rng.next() * C, rng.next() * C, rng.range( 8, 30 ), rng.range( 4, 12 ), rng.next() * 3, 0, Math.PI * 2 );
			c.fill();

		}

	} );

	// --- crocs: ventilation holes across the toe box + pebble texture -----------------------
	drawCell( ctx, 'crocs', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 3000; i ++ ) {

			c.fillStyle = `rgba(0,0,0,${rng.range( 0.02, 0.06 )})`;
			c.fillRect( rng.next() * C, rng.next() * C, 2, 2 );

		}

		// holes: v (along the shoe) 0.55..0.9 is the toe box, u around 0.25..0.75 is the top
		for ( let row = 0; row < 3; row ++ ) {

			const n = 5 - row;
			for ( let i = 0; i < n; i ++ ) {

				const u = 0.5 + ( i - ( n - 1 ) / 2 ) * 0.09;
				const v = 0.62 + row * 0.1;
				c.fillStyle = '#2e3318';
				c.beginPath();
				c.arc( u * C, v * C, 9, 0, Math.PI * 2 );
				c.fill();

			}

		}

	} );

	drawCell( ctx, 'sole', ( c ) => {

		c.fillStyle = '#c9c4b8';
		c.fillRect( 0, 0, C, C );

	} );

	// --- hair: vertical strand streaks (v runs root→tip) ------------------------------------
	drawCell( ctx, 'hair', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 400; i ++ ) {

			const x = rng.next() * C;
			c.strokeStyle = `rgba(${rng.chance( 0.5 ) ? '0,0,0' : '255,255,255'},${rng.range( 0.04, 0.16 )})`;
			c.lineWidth = rng.range( 1, 3 );
			c.beginPath();
			c.moveTo( x, 0 );
			c.lineTo( x + rng.range( - 6, 6 ), C );
			c.stroke();

		}

	} );

	// --- soft cotton weave for the yellow tee ----------------------------------------------
	drawCell( ctx, 'cotton', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );
		for ( let y = 0; y < C; y += 3 ) {

			for ( let x = 0; x < C; x += 3 ) {

				c.fillStyle = `rgba(0,0,0,${( ( x + y ) / 3 ) % 2 ? 0.05 : 0.02})`;
				c.fillRect( x, y, 2, 2 );

			}

		}

	} );

	drawCell( ctx, 'tee', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );
		for ( let i = 0; i < 3000; i ++ ) {

			c.fillStyle = `rgba(0,0,0,${rng.range( 0.02, 0.1 )})`;
			c.fillRect( rng.next() * C, rng.next() * C, 2, 2 );

		}

		for ( let i = 0; i < 8; i ++ ) {

			c.fillStyle = `rgba(40,30,20,${rng.range( 0.2, 0.45 )})`;
			c.beginPath();
			c.ellipse( rng.next() * C, rng.next() * C, rng.range( 10, 40 ), rng.range( 6, 20 ), rng.next() * 3, 0, Math.PI * 2 );
			c.fill();

		}

	} );

	drawCell( ctx, 'iris', ( c ) => {

		c.fillStyle = '#ffffff';
		c.fillRect( 0, 0, C, C );

	} );

	const tex = new THREE.CanvasTexture( canvas );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.needsUpdate = true;
	return tex;

}
