// Axis-aligned box colliders with optional roof profiles, stored in a uniform spatial hash.
// Everything walkable/climbable in the world is described with these.

export const ROOF_FLAT = 0, ROOF_HIP = 1, ROOF_GABLE_X = 2, ROOF_GABLE_Z = 3;

export class Physics {

	constructor( cell = 16 ) {

		this.cell = cell;
		this.grid = new Map();
		this.globals = []; // huge colliders (river banks) tested every query
		this.all = [];
		this._stamp = 0;

	}

	// roof: { type, h } — h is the height of the roof above maxY
	add( minX, minY, minZ, maxX, maxY, maxZ, roof = null, opts = {} ) {

		const c = {
			minX, minY, minZ, maxX, maxY, maxZ,
			roofType: roof ? roof.type : ROOF_FLAT,
			roofH: roof ? roof.h : 0,
			climbable: opts.climbable !== false,
			tag: opts.tag || null,
			_stamp: 0,
		};
		c.top = maxY + c.roofH;
		this.all.push( c );

		const size = Math.max( maxX - minX, maxZ - minZ );
		if ( size > this.cell * 24 ) {

			this.globals.push( c );
			return c;

		}

		const x0 = Math.floor( minX / this.cell ), x1 = Math.floor( maxX / this.cell );
		const z0 = Math.floor( minZ / this.cell ), z1 = Math.floor( maxZ / this.cell );
		for ( let x = x0; x <= x1; x ++ ) {

			for ( let z = z0; z <= z1; z ++ ) {

				const k = x * 73856093 ^ z * 19349663;
				let list = this.grid.get( k );
				if ( ! list ) this.grid.set( k, list = [] );
				list.push( c );

			}

		}

		return c;

	}

	// Collect unique colliders overlapping the XZ rectangle.
	query( minX, minZ, maxX, maxZ, out = [] ) {

		out.length = 0;
		const stamp = ++ this._stamp;
		const x0 = Math.floor( minX / this.cell ), x1 = Math.floor( maxX / this.cell );
		const z0 = Math.floor( minZ / this.cell ), z1 = Math.floor( maxZ / this.cell );
		for ( let x = x0; x <= x1; x ++ ) {

			for ( let z = z0; z <= z1; z ++ ) {

				const list = this.grid.get( x * 73856093 ^ z * 19349663 );
				if ( ! list ) continue;
				for ( const c of list ) {

					if ( c._stamp === stamp ) continue;
					c._stamp = stamp;
					if ( c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ ) continue;
					out.push( c );

				}

			}

		}

		for ( const c of this.globals ) {

			if ( c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ ) continue;
			out.push( c );

		}

		return out;

	}

	// Height of the walkable surface of collider c at (x, z) (assumes the point is inside its footprint).
	static surface( c, x, z ) {

		if ( c.roofType === ROOF_FLAT || c.roofH <= 0 ) return c.maxY;
		const hw = ( c.maxX - c.minX ) * 0.5, hd = ( c.maxZ - c.minZ ) * 0.5;
		const dx = hw - Math.abs( x - ( c.minX + hw ) ), dz = hd - Math.abs( z - ( c.minZ + hd ) );
		let t;
		if ( c.roofType === ROOF_HIP ) {

			t = Math.min( dx, dz ) / Math.min( hw, hd );

		} else if ( c.roofType === ROOF_GABLE_X ) {

			t = dz / hd;

		} else {

			t = dx / hw;

		}

		return c.maxY + c.roofH * Math.max( 0, Math.min( 1, t ) );

	}

	// Highest surface under (x,z) not more than `maxRise` above y.
	groundAt( x, z, y, maxRise = 0.5, list = [] ) {

		this.query( x, z, x, z, list );
		let best = - 50;
		let bestC = null;
		for ( const c of list ) {

			if ( x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ ) continue;
			const s = Physics.surface( c, x, z );
			if ( s <= y + maxRise && s > best ) {

				best = s;
				bestC = c;

			}

		}

		this.lastGround = bestC;
		return best;

	}

	// Is a point inside solid geometry (used by the camera)?
	solidAt( x, y, z, list = [] ) {

		this.query( x, z, x, z, list );
		for ( const c of list ) {

			if ( x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ ) continue;
			if ( y < c.minY ) continue;
			if ( y < Physics.surface( c, x, z ) ) return true;

		}

		return false;

	}

}
