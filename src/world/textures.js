import * as THREE from 'three/webgpu';
import { createRng } from '../core/rng.js';

// All surface detail is painted procedurally into canvases at startup — no external assets needed.

function canvas( w, h ) {

	const c = document.createElement( 'canvas' );
	c.width = w;
	c.height = h;
	return [ c, c.getContext( '2d' ) ];

}

function toTexture( c, { srgb = true, repeat = true, aniso = 8 } = {} ) {

	const t = new THREE.CanvasTexture( c );
	if ( srgb ) t.colorSpace = THREE.SRGBColorSpace;
	if ( repeat ) t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = aniso;
	t.generateMipmaps = true;
	t.minFilter = THREE.LinearMipmapLinearFilter;
	t.needsUpdate = true;
	return t;

}

function speckle( ctx, w, h, rng, count, colors, size = [ 1, 3 ] ) {

	for ( let i = 0; i < count; i ++ ) {

		ctx.fillStyle = rng.pick( colors );
		const s = rng.range( size[ 0 ], size[ 1 ] );
		ctx.fillRect( rng.next() * w, rng.next() * h, s, s );

	}

}

function grime( ctx, w, h, rng, alpha = 0.12 ) {

	// soft vertical streaks of weathering
	for ( let i = 0; i < 40; i ++ ) {

		const x = rng.next() * w;
		const g = ctx.createLinearGradient( 0, 0, 0, h );
		g.addColorStop( 0, `rgba(70,60,45,${alpha * rng.next()})` );
		g.addColorStop( 1, 'rgba(70,60,45,0)' );
		ctx.fillStyle = g;
		ctx.fillRect( x, 0, rng.range( 2, 14 ), h * rng.range( 0.3, 1 ) );

	}

}

function stoneBase( ctx, w, h, rng, base, rowH, light = 0 ) {

	ctx.fillStyle = base;
	ctx.fillRect( 0, 0, w, h );
	speckle( ctx, w, h, rng, w * h / 18, [ 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.05)', 'rgba(120,100,70,0.06)' ], [ 1, 3 ] );
	// ashlar courses
	ctx.strokeStyle = `rgba(110,95,70,${0.28 + light})`;
	ctx.lineWidth = 1.2;
	for ( let y = rowH, row = 0; y < h + 1; y += rowH, row ++ ) {

		ctx.beginPath();
		ctx.moveTo( 0, y );
		ctx.lineTo( w, y );
		ctx.stroke();
		const off = ( row % 2 ) * rowH * 1.2;
		for ( let x = off; x < w; x += rowH * 2.4 ) {

			ctx.beginPath();
			ctx.moveTo( x, y - rowH );
			ctx.lineTo( x, y );
			ctx.stroke();

		}

	}

	// tonal variation per block
	for ( let y = 0; y < h; y += rowH ) {

		for ( let x = 0; x < w; x += rowH * 2.4 ) {

			ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '255,250,235' : '90,75,50'},${rng.range( 0, 0.06 )})`;
			ctx.fillRect( x, y, rowH * 2.4, rowH );

		}

	}

}

// ---------------------------------------------------------------------------------------------
// Facades: one texture = 4 window bays wide x 1 storey high (upper) / ground storey (shops).

const BAY_PX = 256;
export const FLOOR_H = 3.3;
export const GROUND_H = 4.2;

const SHUTTERS = [ '#8d9ba1', '#9aa5a6', '#6f8a8f', '#b7b9b0', '#7e8f78', '#5d7a8c' ];

function drawFrenchWindow( ctx, rough, x, y, w, h, rng, opts ) {

	const { shutter, shutterOpen, balcony, arch, keystone } = opts;
	// surround
	ctx.fillStyle = 'rgba(255,248,230,0.35)';
	ctx.fillRect( x - 9, y - 9, w + 18, h + 14 );
	ctx.strokeStyle = 'rgba(120,100,70,0.35)';
	ctx.lineWidth = 2;
	ctx.strokeRect( x - 9, y - 9, w + 18, h + 14 );

	// glass
	const g = ctx.createLinearGradient( x, y, x + w, y + h );
	g.addColorStop( 0, '#5b6c78' );
	g.addColorStop( 0.45, '#2c3a45' );
	g.addColorStop( 0.55, '#3e505d' );
	g.addColorStop( 1, '#1d262d' );
	ctx.fillStyle = g;
	ctx.beginPath();
	if ( arch ) {

		ctx.moveTo( x, y + h );
		ctx.lineTo( x, y + w * 0.5 );
		ctx.arc( x + w / 2, y + w * 0.5, w / 2, Math.PI, 0 );
		ctx.lineTo( x + w, y + h );

	} else {

		ctx.rect( x, y, w, h );

	}

	ctx.fill();
	rough.fillStyle = '#1a1a1a';
	rough.fillRect( x, y, w, h );

	// curtains / interior hints
	if ( rng.chance( 0.6 ) ) {

		ctx.fillStyle = `rgba(${rng.pick( [ '230,225,210', '200,190,170', '160,60,50', '210,210,200' ] )},0.35)`;
		ctx.fillRect( x + 4, y + 6, w * 0.3, h - 10 );
		ctx.fillRect( x + w * 0.7 - 4, y + 6, w * 0.3, h - 10 );

	}

	// frames & glazing bars
	ctx.strokeStyle = '#ece8df';
	ctx.lineWidth = 4;
	ctx.strokeRect( x + 2, y + 2, w - 4, h - 4 );
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo( x + w / 2, y );
	ctx.lineTo( x + w / 2, y + h );
	for ( let i = 1; i < 4; i ++ ) {

		ctx.moveTo( x, y + h * i / 4 );
		ctx.lineTo( x + w, y + h * i / 4 );

	}

	ctx.stroke();

	if ( keystone ) {

		ctx.fillStyle = 'rgba(255,250,235,0.55)';
		ctx.beginPath();
		ctx.moveTo( x + w / 2 - 12, y - 10 );
		ctx.lineTo( x + w / 2 + 12, y - 10 );
		ctx.lineTo( x + w / 2 + 8, y + 10 );
		ctx.lineTo( x + w / 2 - 8, y + 10 );
		ctx.fill();
		ctx.strokeStyle = 'rgba(110,90,60,0.4)';
		ctx.lineWidth = 1.5;
		ctx.stroke();

	}

	// shutters
	if ( shutter ) {

		const sw = w * 0.5;
		const drawShutter = ( sx, sy, swid ) => {

			ctx.fillStyle = shutter;
			ctx.fillRect( sx, sy, swid, h );
			ctx.strokeStyle = 'rgba(0,0,0,0.25)';
			ctx.lineWidth = 1;
			for ( let ly = sy + 6; ly < sy + h; ly += 7 ) {

				ctx.beginPath();
				ctx.moveTo( sx + 3, ly );
				ctx.lineTo( sx + swid - 3, ly );
				ctx.stroke();

			}

			ctx.strokeStyle = 'rgba(0,0,0,0.35)';
			ctx.strokeRect( sx + 1, sy + 1, swid - 2, h - 2 );
			rough.fillStyle = '#9a9a9a';
			rough.fillRect( sx, sy, swid, h );

		};

		if ( shutterOpen ) {

			drawShutter( x - sw - 10, y, sw );
			drawShutter( x + w + 10, y, sw );

		} else {

			drawShutter( x, y, sw );
			drawShutter( x + sw, y, sw );

		}

	}

	// wrought iron balcony
	if ( balcony ) {

		const by = y + h * 0.68;
		const bx0 = balcony === 'long' ? x - 40 : x - 6, bx1 = balcony === 'long' ? x + w + 40 : x + w + 6;
		ctx.fillStyle = 'rgba(0,0,0,0.25)';
		ctx.fillRect( bx0, y + h + 2, bx1 - bx0, 6 );
		ctx.fillStyle = '#e8e0cc';
		ctx.fillRect( bx0 - 2, y + h - 2, bx1 - bx0 + 4, 7 );
		ctx.strokeStyle = '#1e1e1e';
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.moveTo( bx0, by );
		ctx.lineTo( bx1, by );
		ctx.stroke();
		ctx.lineWidth = 1.6;
		for ( let bx = bx0 + 3; bx < bx1; bx += 7 ) {

			ctx.beginPath();
			ctx.moveTo( bx, by );
			ctx.lineTo( bx, y + h - 2 );
			ctx.stroke();

		}

		for ( let bx = bx0 + 12; bx < bx1 - 8; bx += 22 ) {

			ctx.beginPath();
			ctx.arc( bx, by + 12, 6, 0, Math.PI * 2 );
			ctx.stroke();

		}

	}

}

function makeFacadeUpper( style, seed ) {

	const rng = createRng( seed );
	const W = BAY_PX * 4, H = Math.round( BAY_PX * FLOOR_H / 3.2 );
	const [ c, ctx ] = canvas( W, H );
	const [ rc, rough ] = canvas( W, H );
	const bases = [ '#e4d6b8', '#ddcca9', '#ece2cb' ];
	stoneBase( ctx, W, H, rng, bases[ style ], H / 7 );
	rough.fillStyle = '#e6e6e6';
	rough.fillRect( 0, 0, W, H );

	// floor band / cornice line at the bottom of each storey
	ctx.fillStyle = 'rgba(255,250,235,0.45)';
	ctx.fillRect( 0, H - 8, W, 8 );
	ctx.fillStyle = 'rgba(80,65,40,0.25)';
	ctx.fillRect( 0, H - 9, W, 2 );

	const ww = BAY_PX * 0.36, wh = H * 0.66;
	for ( let i = 0; i < 4; i ++ ) {

		const x = i * BAY_PX + ( BAY_PX - ww ) / 2;
		const y = H * 0.13;
		const shutter = style === 1 ? null : ( rng.chance( 0.75 ) ? rng.pick( SHUTTERS ) : null );
		drawFrenchWindow( ctx, rough, x, y, ww, wh, rng, {
			shutter,
			shutterOpen: rng.chance( 0.75 ),
			balcony: style === 1 ? ( i === 1 || i === 2 ? 'long' : null ) : ( rng.chance( 0.5 ) ? 'short' : null ),
			arch: style === 1 && rng.chance( 0.5 ),
			keystone: style !== 2,
		} );

	}

	grime( ctx, W, H, rng, 0.1 );
	return { map: toTexture( c ), roughnessMap: toTexture( rc, { srgb: false } ) };

}

function makeFacadeGround( seed ) {

	const rng = createRng( seed );
	const W = BAY_PX * 4, H = Math.round( BAY_PX * GROUND_H / 3.2 );
	const [ c, ctx ] = canvas( W, H );
	const [ rc, rough ] = canvas( W, H );
	stoneBase( ctx, W, H, rng, '#d9c8a5', H / 9, 0.25 );
	rough.fillStyle = '#e8e8e8';
	rough.fillRect( 0, 0, W, H );
	// rusticated grooves
	ctx.fillStyle = 'rgba(70,55,35,0.35)';
	for ( let y = H / 9; y < H; y += H / 9 ) ctx.fillRect( 0, y - 1, W, 3 );

	const doorColors = [ '#2f4a3c', '#5a1f22', '#1f2b44', '#3b2a1c', '#555a5c' ];
	for ( let i = 0; i < 4; i ++ ) {

		const kind = rng.pick( [ 'shop', 'shop', 'door', 'window' ] );
		const w = kind === 'shop' ? BAY_PX * 0.66 : BAY_PX * 0.42;
		const x = i * BAY_PX + ( BAY_PX - w ) / 2;
		const top = H * 0.2, bottom = H;
		const r = w / 2;
		// arch voussoirs
		ctx.fillStyle = 'rgba(245,238,220,0.7)';
		ctx.beginPath();
		ctx.moveTo( x - 10, bottom );
		ctx.lineTo( x - 10, top + r );
		ctx.arc( x + r, top + r, r + 10, Math.PI, 0 );
		ctx.lineTo( x + w + 10, bottom );
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo( x, bottom );
		ctx.lineTo( x, top + r );
		ctx.arc( x + r, top + r, r, Math.PI, 0 );
		ctx.lineTo( x + w, bottom );
		ctx.closePath();
		const col = rng.pick( doorColors );
		if ( kind === 'door' ) {

			ctx.fillStyle = col;
			ctx.fill();
			ctx.strokeStyle = 'rgba(0,0,0,0.4)';
			ctx.lineWidth = 2;
			for ( let k = 0; k < 2; k ++ ) ctx.strokeRect( x + 8 + k * ( w / 2 - 4 ), top + r + 10, w / 2 - 12, bottom - top - r - 20 );
			rough.fillStyle = '#888';
			rough.fillRect( x, top, w, bottom - top );

		} else {

			const g = ctx.createLinearGradient( x, top, x + w, bottom );
			g.addColorStop( 0, '#4d5d66' );
			g.addColorStop( 0.5, '#1f2a31' );
			g.addColorStop( 1, '#323f47' );
			ctx.fillStyle = g;
			ctx.fill();
			rough.fillStyle = '#1c1c1c';
			rough.fillRect( x, top, w, bottom - top );
			ctx.strokeStyle = col;
			ctx.lineWidth = 6;
			ctx.stroke();
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo( x, top + r );
			ctx.lineTo( x + w, top + r );
			ctx.moveTo( x + w / 2, top + r );
			ctx.lineTo( x + w / 2, bottom );
			ctx.stroke();
			if ( kind === 'shop' ) {

				// shop sign + display
				ctx.fillStyle = col;
				ctx.fillRect( x + 6, top + r + 4, w - 12, 18 );
				ctx.fillStyle = '#e9d9a8';
				ctx.font = 'bold 13px Georgia, serif';
				ctx.textAlign = 'center';
				ctx.fillText( rng.pick( [ 'BOULANGERIE', 'CAFÉ', 'LIBRAIRIE', 'FROMAGERIE', 'TABAC', 'VINS', 'PHARMACIE', 'BISTROT' ] ), x + w / 2, top + r + 18 );
				for ( let k = 0; k < 6; k ++ ) {

					ctx.fillStyle = `hsla(${rng.range( 0, 360 )},40%,60%,0.5)`;
					ctx.fillRect( x + 10 + k * ( w - 20 ) / 6, bottom - 40, ( w - 20 ) / 6 - 4, 18 );

				}

			}

		}

	}

	// grime near the street
	const g = ctx.createLinearGradient( 0, H * 0.75, 0, H );
	g.addColorStop( 0, 'rgba(60,50,35,0)' );
	g.addColorStop( 1, 'rgba(60,50,35,0.35)' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, H * 0.75, W, H * 0.25 );
	return { map: toTexture( c ), roughnessMap: toTexture( rc, { srgb: false } ) };

}

function makePlainStone( seed, base = '#e2d4b6', rows = 8 ) {

	const rng = createRng( seed );
	const [ c, ctx ] = canvas( 512, 512 );
	stoneBase( ctx, 512, 512, rng, base, 512 / rows );
	grime( ctx, 512, 512, rng, 0.08 );
	return toTexture( c );

}

function makeRoofTiles( seed ) {

	const rng = createRng( seed );
	const S = 512;
	const [ c, ctx ] = canvas( S, S );
	const [ bc, bump ] = canvas( S, S );
	ctx.fillStyle = '#a5552f';
	ctx.fillRect( 0, 0, S, S );
	bump.fillStyle = '#000';
	bump.fillRect( 0, 0, S, S );
	const cols = 16, rows = 12;
	const cw = S / cols, rh = S / rows;
	for ( let r = 0; r < rows; r ++ ) {

		for ( let k = 0; k < cols; k ++ ) {

			const x = k * cw, y = r * rh;
			const hue = rng.range( 10, 24 ), sat = rng.range( 45, 62 ), lit = rng.range( 33, 50 );
			const g = ctx.createLinearGradient( x, 0, x + cw, 0 );
			g.addColorStop( 0, `hsl(${hue},${sat}%,${lit - 12}%)` );
			g.addColorStop( 0.5, `hsl(${hue},${sat}%,${lit + 6}%)` );
			g.addColorStop( 1, `hsl(${hue},${sat}%,${lit - 14}%)` );
			ctx.fillStyle = g;
			ctx.fillRect( x + 1, y, cw - 2, rh + 3 );
			const bg = bump.createLinearGradient( x, 0, x + cw, 0 );
			bg.addColorStop( 0, '#202020' );
			bg.addColorStop( 0.5, '#ffffff' );
			bg.addColorStop( 1, '#202020' );
			bump.fillStyle = bg;
			bump.fillRect( x + 1, y, cw - 2, rh + 3 );
			// lip shadow
			ctx.fillStyle = 'rgba(40,15,5,0.45)';
			ctx.fillRect( x, y + rh - 3, cw, 3 );

		}

	}

	// lichen & dirt patches
	for ( let i = 0; i < 60; i ++ ) {

		ctx.fillStyle = rng.chance( 0.5 ) ? `rgba(90,85,60,${rng.range( 0.05, 0.2 )})` : `rgba(40,30,20,${rng.range( 0.05, 0.2 )})`;
		ctx.beginPath();
		ctx.arc( rng.next() * S, rng.next() * S, rng.range( 5, 40 ), 0, Math.PI * 2 );
		ctx.fill();

	}

	return { map: toTexture( c ), bumpMap: toTexture( bc, { srgb: false } ) };

}

function makePaving( seed ) {

	const rng = createRng( seed );
	const S = 512;
	const [ c, ctx ] = canvas( S, S );
	ctx.fillStyle = '#b5ac9c';
	ctx.fillRect( 0, 0, S, S );
	const rows = 8;
	const rh = S / rows;
	for ( let r = 0; r < rows; r ++ ) {

		let x = - rng.range( 0, 60 );
		while ( x < S ) {

			const w = rng.range( 50, 110 );
			const l = rng.range( 62, 74 );
			ctx.fillStyle = `hsl(${rng.range( 30, 42 )},${rng.range( 8, 16 )}%,${l}%)`;
			ctx.fillRect( x + 2, r * rh + 2, w - 3, rh - 3 );
			if ( x + w > S ) {

				ctx.fillRect( x + 2 - S, r * rh + 2, w - 3, rh - 3 );

			}

			x += w;

		}

	}

	speckle( ctx, S, S, rng, 9000, [ 'rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)' ] );
	for ( let i = 0; i < 25; i ++ ) {

		ctx.fillStyle = `rgba(60,55,45,${rng.range( 0.03, 0.08 )})`;
		ctx.beginPath();
		ctx.arc( rng.next() * S, rng.next() * S, rng.range( 10, 60 ), 0, Math.PI * 2 );
		ctx.fill();

	}

	return toTexture( c );

}

function makeAsphalt( seed ) {

	const rng = createRng( seed );
	const S = 256;
	const [ c, ctx ] = canvas( S, S );
	ctx.fillStyle = '#4a4a4c';
	ctx.fillRect( 0, 0, S, S );
	speckle( ctx, S, S, rng, 7000, [ 'rgba(0,0,0,0.12)', 'rgba(255,255,255,0.07)', 'rgba(120,110,100,0.1)' ], [ 1, 2 ] );
	return toTexture( c );

}

function makeGothicWall( seed ) {

	// One bay: buttress-framed lancet window with stained glass.
	const rng = createRng( seed );
	const W = 256, H = 512;
	const [ c, ctx ] = canvas( W, H );
	const [ rc, rough ] = canvas( W, H );
	stoneBase( ctx, W, H, rng, '#c9b994', H / 22, 0.1 );
	rough.fillStyle = '#e0e0e0';
	rough.fillRect( 0, 0, W, H );
	const x = W * 0.3, w = W * 0.4, top = H * 0.12, bottom = H * 0.86;
	// moulding
	ctx.fillStyle = 'rgba(80,65,45,0.35)';
	lancet( ctx, x - 10, top - 10, w + 20, bottom - top + 10 );
	ctx.fill();
	ctx.fillStyle = 'rgba(240,230,205,0.5)';
	lancet( ctx, x - 5, top - 5, w + 10, bottom - top + 5 );
	ctx.fill();
	// glass
	lancet( ctx, x, top, w, bottom - top );
	ctx.save();
	ctx.clip();
	const glass = [ '#1f2d5c', '#5a1c2a', '#22403a', '#3a2a5a', '#1b3550' ];
	for ( let gy = top; gy < bottom; gy += 9 ) {

		for ( let gx = x; gx < x + w; gx += 9 ) {

			ctx.fillStyle = rng.pick( glass );
			ctx.fillRect( gx, gy, 9, 9 );

		}

	}

	ctx.strokeStyle = '#2a2622';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo( x + w / 2, top );
	ctx.lineTo( x + w / 2, bottom );
	for ( let gy = top + 40; gy < bottom; gy += 40 ) {

		ctx.moveTo( x, gy );
		ctx.lineTo( x + w, gy );

	}

	ctx.stroke();
	ctx.restore();
	rough.fillStyle = '#222';
	rough.fillRect( x, top, w, bottom - top );
	// buttress shading at the edges
	const g = ctx.createLinearGradient( 0, 0, W, 0 );
	g.addColorStop( 0, 'rgba(60,50,35,0.35)' );
	g.addColorStop( 0.12, 'rgba(60,50,35,0)' );
	g.addColorStop( 0.88, 'rgba(60,50,35,0)' );
	g.addColorStop( 1, 'rgba(60,50,35,0.35)' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, W, H );
	grime( ctx, W, H, rng, 0.18 );
	return { map: toTexture( c ), roughnessMap: toTexture( rc, { srgb: false } ) };

}

function lancet( ctx, x, y, w, h ) {

	const r = w * 0.9;
	ctx.beginPath();
	ctx.moveTo( x, y + h );
	ctx.lineTo( x, y + w * 0.75 );
	ctx.arc( x + r, y + w * 0.75, r, Math.PI, Math.PI + 0.98, false );
	ctx.arc( x + w - r, y + w * 0.75, r, - 0.98 - 0.0, 0, false );
	ctx.lineTo( x + w, y + h );
	ctx.closePath();

}

function makeSlate( seed ) {

	const rng = createRng( seed );
	const S = 256;
	const [ c, ctx ] = canvas( S, S );
	ctx.fillStyle = '#5d6168';
	ctx.fillRect( 0, 0, S, S );
	for ( let y = 0; y < S; y += 12 ) {

		for ( let x = ( y / 12 ) % 2 * 10; x < S; x += 20 ) {

			ctx.fillStyle = `hsl(215,${rng.range( 4, 10 )}%,${rng.range( 36, 48 )}%)`;
			ctx.fillRect( x + 1, y + 1, 18, 11 );

		}

	}

	return toTexture( c );

}

function makeBrick( seed ) {

	// Pont de Pierre: pink brick spandrels with pale stone bands.
	const rng = createRng( seed );
	const S = 512;
	const [ c, ctx ] = canvas( S, S );
	ctx.fillStyle = '#c9a07e';
	ctx.fillRect( 0, 0, S, S );
	const bh = 10;
	for ( let y = 0, r = 0; y < S; y += bh, r ++ ) {

		for ( let x = ( r % 2 ) * 12; x < S + 24; x += 24 ) {

			ctx.fillStyle = `hsl(${rng.range( 8, 18 )},${rng.range( 35, 50 )}%,${rng.range( 45, 58 )}%)`;
			ctx.fillRect( x - 24 + 1, y + 1, 22, bh - 2 );

		}

	}

	// stone bands
	ctx.fillStyle = '#e3d8c2';
	ctx.fillRect( 0, 0, S, 26 );
	ctx.fillRect( 0, S / 2, S, 20 );
	speckle( ctx, S, S, rng, 6000, [ 'rgba(0,0,0,0.05)', 'rgba(255,255,255,0.05)' ] );
	return toTexture( c );

}

export function makePockyLabel() {

	const [ c, ctx ] = canvas( 256, 384 );
	const g = ctx.createLinearGradient( 0, 0, 0, 384 );
	g.addColorStop( 0, '#ff2a3d' );
	g.addColorStop( 1, '#c5101f' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, 256, 384 );
	// sticks
	for ( let i = 0; i < 5; i ++ ) {

		ctx.save();
		ctx.translate( 70 + i * 26, 360 );
		ctx.rotate( - 0.35 + i * 0.05 );
		ctx.fillStyle = '#f2d39b';
		ctx.fillRect( - 5, - 110, 10, 110 );
		ctx.fillStyle = '#4a2416';
		ctx.fillRect( - 6, - 330, 12, 225 );
		ctx.restore();

	}

	ctx.fillStyle = '#fff';
	ctx.font = 'italic 900 84px "Arial Black", Arial, sans-serif';
	ctx.textAlign = 'center';
	ctx.shadowColor = 'rgba(0,0,0,0.3)';
	ctx.shadowBlur = 6;
	ctx.fillText( 'Pocky', 128, 110 );
	ctx.font = 'bold 26px Arial, sans-serif';
	ctx.fillText( 'CHOCOLATE', 128, 148 );
	return toTexture( c, { repeat: false } );

}

// ---------------------------------------------------------------------------------------------
// Anime face (painted onto a front sphere segment in front of the head).

export function makeFace( expression = 'neutral' ) {

	const S = 512;
	const [ c, ctx ] = canvas( S, S );
	ctx.clearRect( 0, 0, S, S );
	const cx = S / 2;
	const eyeY = S * 0.5;
	const eyeDX = S * 0.16;
	const flustered = expression === 'flustered';

	if ( flustered ) {

		// blush
		for ( const side of [ - 1, 1 ] ) {

			const g = ctx.createRadialGradient( cx + side * S * 0.2, eyeY + S * 0.12, 2, cx + side * S * 0.2, eyeY + S * 0.12, S * 0.11 );
			g.addColorStop( 0, 'rgba(255,90,110,0.75)' );
			g.addColorStop( 1, 'rgba(255,90,110,0)' );
			ctx.fillStyle = g;
			ctx.fillRect( 0, 0, S, S );
			ctx.strokeStyle = 'rgba(210,50,70,0.8)';
			ctx.lineWidth = 3;
			for ( let k = 0; k < 3; k ++ ) {

				const x = cx + side * S * 0.2 + ( k - 1 ) * 14;
				ctx.beginPath();
				ctx.moveTo( x + 6, eyeY + S * 0.1 );
				ctx.lineTo( x - 4, eyeY + S * 0.14 );
				ctx.stroke();

			}

		}

	}

	for ( const side of [ - 1, 1 ] ) {

		const ex = cx + side * eyeDX;
		const ew = S * 0.08, eh = flustered ? S * 0.1 : S * 0.09;
		// sclera
		ctx.fillStyle = '#fbf8f4';
		ctx.beginPath();
		ctx.ellipse( ex, eyeY, ew, eh, 0, 0, Math.PI * 2 );
		ctx.fill();
		// iris
		const ir = flustered ? ew * 0.55 : ew * 0.82;
		const g = ctx.createLinearGradient( 0, eyeY - eh, 0, eyeY + eh );
		g.addColorStop( 0, '#7a4a12' );
		g.addColorStop( 0.5, '#c98b2e' );
		g.addColorStop( 1, '#f0bf5c' );
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.ellipse( ex + side * - 2, eyeY + 4, ir, eh * 0.92, 0, 0, Math.PI * 2 );
		ctx.fill();
		// pupil (cat-ish slit)
		ctx.fillStyle = '#2b1606';
		ctx.beginPath();
		ctx.ellipse( ex + side * - 2, eyeY + 4, ir * 0.32, eh * 0.55, 0, 0, Math.PI * 2 );
		ctx.fill();
		// highlights
		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc( ex - ir * 0.35, eyeY - eh * 0.35, ir * 0.28, 0, Math.PI * 2 );
		ctx.fill();
		ctx.beginPath();
		ctx.arc( ex + ir * 0.35, eyeY + eh * 0.35, ir * 0.12, 0, Math.PI * 2 );
		ctx.fill();
		// upper lash line
		ctx.strokeStyle = '#2a1a14';
		ctx.lineWidth = 9;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.ellipse( ex, eyeY + 6, ew * 1.12, eh * 1.08, 0, Math.PI * 1.08, Math.PI * 1.92 );
		ctx.stroke();
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo( ex + side * ew * 1.05, eyeY - eh * 0.45 );
		ctx.lineTo( ex + side * ew * 1.35, eyeY - eh * 0.7 );
		ctx.stroke();
		// lower lash hint
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.ellipse( ex, eyeY - 2, ew * 0.95, eh * 1.0, 0, Math.PI * 0.25, Math.PI * 0.75 );
		ctx.stroke();
		// brow
		ctx.lineWidth = 4;
		ctx.strokeStyle = '#7fa38c';
		ctx.beginPath();
		if ( flustered ) {

			ctx.moveTo( ex - side * ew * 0.9, eyeY - eh * 1.6 );
			ctx.quadraticCurveTo( ex, eyeY - eh * 2.0, ex + side * ew * 1.1, eyeY - eh * 1.9 );

		} else {

			ctx.moveTo( ex - side * ew * 0.9, eyeY - eh * 1.75 );
			ctx.quadraticCurveTo( ex, eyeY - eh * 1.95, ex + side * ew * 1.1, eyeY - eh * 1.7 );

		}

		ctx.stroke();

	}

	// nose
	ctx.strokeStyle = 'rgba(180,110,90,0.7)';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo( cx + 2, eyeY + S * 0.105 );
	ctx.lineTo( cx - 2, eyeY + S * 0.12 );
	ctx.stroke();

	// mouth
	ctx.strokeStyle = '#7a3a33';
	ctx.lineWidth = 4;
	ctx.beginPath();
	const my = eyeY + S * 0.2;
	if ( flustered ) {

		ctx.moveTo( cx - 20, my );
		ctx.quadraticCurveTo( cx - 10, my - 8, cx, my );
		ctx.quadraticCurveTo( cx + 10, my + 8, cx + 20, my );

	} else {

		ctx.moveTo( cx - 12, my );
		ctx.quadraticCurveTo( cx, my + 4, cx + 12, my );

	}

	ctx.stroke();

	if ( flustered ) {

		// sweat drop
		ctx.fillStyle = 'rgba(170,220,255,0.9)';
		ctx.beginPath();
		ctx.moveTo( cx + S * 0.27, eyeY - S * 0.16 );
		ctx.quadraticCurveTo( cx + S * 0.3, eyeY - S * 0.1, cx + S * 0.27, eyeY - S * 0.08 );
		ctx.quadraticCurveTo( cx + S * 0.24, eyeY - S * 0.1, cx + S * 0.27, eyeY - S * 0.16 );
		ctx.fill();

	}

	return toTexture( c, { repeat: false } );

}

export function createTextures() {

	return {
		upper: [ makeFacadeUpper( 0, 11 ), makeFacadeUpper( 1, 22 ), makeFacadeUpper( 2, 33 ) ],
		ground: [ makeFacadeGround( 44 ), makeFacadeGround( 55 ) ],
		plain: makePlainStone( 66 ),
		roof: makeRoofTiles( 77 ),
		paving: makePaving( 88 ),
		asphalt: makeAsphalt( 99 ),
		gothic: makeGothicWall( 111 ),
		gothicPlain: makePlainStone( 122, '#c8b893', 12 ),
		slate: makeSlate( 133 ),
		brick: makeBrick( 144 ),
		quay: makePlainStone( 155, '#b8ab90', 10 ),
	};

}
