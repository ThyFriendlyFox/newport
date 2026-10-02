// Keyboard + mouse (pointer lock) + touch (virtual stick, look pad, buttons).

export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set(); // edge-triggered this frame
		this.look = { x: 0, y: 0 };
		this.zoom = 0;
		this.stick = { x: 0, y: 0 };
		this.touchJump = false;
		this.touchRun = false;
		this.locked = false;
		this.isTouch = matchMedia( '(pointer: coarse)' ).matches || 'ontouchstart' in window;

		addEventListener( 'keydown', ( e ) => {

			if ( e.repeat ) return;
			this.keys.add( e.code );
			this.pressed.add( e.code );
			if ( e.code === 'KeyF' || e.code === 'KeyE' ) this.pressed.add( 'Attack' );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight' ].includes( e.code ) ) e.preventDefault();

		} );
		addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		addEventListener( 'blur', () => this.keys.clear() );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );
		dom.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this.dragging ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 && this.locked ) this.pressed.add( 'Attack' );
			if ( e.button === 2 || ! this.locked ) this.dragging = true;

		} );
		addEventListener( 'mouseup', () => this.dragging = false );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		dom.addEventListener( 'wheel', ( e ) => {

			this.zoom += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		if ( this.isTouch ) this.setupTouch();

	}

	requestLock() {

		if ( this.isTouch ) return;
		try {

			const p = this.dom.requestPointerLock?.( { unadjustedMovement: true } );
			if ( p && p.catch ) p.catch( () => this.dom.requestPointerLock?.() );

		} catch {

			/* pointer lock not available — drag-to-look still works */

		}

	}

	setupTouch() {

		const ui = document.getElementById( 'touch' );
		ui.hidden = false;
		const stickEl = ui.querySelector( '.stick' );
		const knob = ui.querySelector( '.knob' );
		let stickId = null, lookId = null, cx = 0, cy = 0, lx = 0, ly = 0;

		const bind = ( sel, on, off ) => {

			const el = ui.querySelector( sel );
			el.addEventListener( 'touchstart', ( e ) => {

				e.preventDefault();
				e.stopPropagation();
				on();
				el.classList.add( 'on' );

			}, { passive: false } );
			el.addEventListener( 'touchend', ( e ) => {

				e.preventDefault();
				off();
				el.classList.remove( 'on' );

			} );

		};

		bind( '.btn-jump', () => {

			this.touchJump = true;
			this.pressed.add( 'Space' );

		}, () => this.touchJump = false );
		bind( '.btn-run', () => this.touchRun = ! this.touchRun, () => {} );
		bind( '.btn-kick', () => this.pressed.add( 'Attack' ), () => {} );

		addEventListener( 'touchstart', ( e ) => {

			for ( const t of e.changedTouches ) {

				if ( t.target.closest && t.target.closest( '.btn' ) ) continue;
				if ( t.clientX < innerWidth * 0.45 && stickId === null ) {

					stickId = t.identifier;
					cx = t.clientX;
					cy = t.clientY;
					stickEl.style.left = cx + 'px';
					stickEl.style.top = cy + 'px';
					stickEl.classList.add( 'on' );

				} else if ( lookId === null ) {

					lookId = t.identifier;
					lx = t.clientX;
					ly = t.clientY;

				}

			}

		}, { passive: true } );

		addEventListener( 'touchmove', ( e ) => {

			for ( const t of e.changedTouches ) {

				if ( t.identifier === stickId ) {

					let dx = ( t.clientX - cx ) / 55, dy = ( t.clientY - cy ) / 55;
					const l = Math.hypot( dx, dy );
					if ( l > 1 ) {

						dx /= l;
						dy /= l;

					}

					this.stick.x = dx;
					this.stick.y = dy;
					knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;

				} else if ( t.identifier === lookId ) {

					this.look.x += ( t.clientX - lx ) * 1.6;
					this.look.y += ( t.clientY - ly ) * 1.6;
					lx = t.clientX;
					ly = t.clientY;

				}

			}

		}, { passive: true } );

		const end = ( e ) => {

			for ( const t of e.changedTouches ) {

				if ( t.identifier === stickId ) {

					stickId = null;
					this.stick.x = this.stick.y = 0;
					knob.style.transform = '';
					stickEl.classList.remove( 'on' );

				} else if ( t.identifier === lookId ) {

					lookId = null;

				}

			}

		};

		addEventListener( 'touchend', end );
		addEventListener( 'touchcancel', end );

	}

	// Movement intent in camera space: x = right, y = forward.
	move() {

		let x = 0, y = 0;
		if ( this.keys.has( 'KeyW' ) || this.keys.has( 'ArrowUp' ) ) y += 1;
		if ( this.keys.has( 'KeyS' ) || this.keys.has( 'ArrowDown' ) ) y -= 1;
		if ( this.keys.has( 'KeyD' ) || this.keys.has( 'ArrowRight' ) ) x += 1;
		if ( this.keys.has( 'KeyA' ) || this.keys.has( 'ArrowLeft' ) ) x -= 1;
		x += this.stick.x;
		y -= this.stick.y;
		const l = Math.hypot( x, y );
		if ( l > 1 ) {

			x /= l;
			y /= l;

		}

		return { x, y };

	}

	get run() {

		return this.keys.has( 'ShiftLeft' ) || this.keys.has( 'ShiftRight' ) || this.touchRun;

	}

	get jumpHeld() {

		return this.keys.has( 'Space' ) || this.touchJump;

	}

	consume( code ) {

		const had = this.pressed.has( code );
		this.pressed.delete( code );
		return had;

	}

	endFrame() {

		this.pressed.clear();
		this.look.x = this.look.y = 0;
		this.zoom = 0;

	}

}
