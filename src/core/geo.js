import * as THREE from 'three/webgpu';

// Growable buffers for procedurally merged geometry (positions, normals, uvs, vertex colors).
export class GeoBatch {

	constructor() {

		this.pos = [];
		this.nrm = [];
		this.uv = [];
		this.col = [];
		this.idx = [];
		this.count = 0;

	}

	vertex( x, y, z, nx, ny, nz, u, v, c ) {

		this.pos.push( x, y, z );
		this.nrm.push( nx, ny, nz );
		this.uv.push( u, v );
		this.col.push( c.r, c.g, c.b );
		return this.count ++;

	}

	// p0..p3 counter-clockwise seen from the front; normal computed from the first triangle.
	quad( p0, p1, p2, p3, uvs, c ) {

		const n = faceNormal( p0, p1, p3 );
		const a = this.vertex( p0[ 0 ], p0[ 1 ], p0[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 0 ], uvs[ 1 ], c );
		const b = this.vertex( p1[ 0 ], p1[ 1 ], p1[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 2 ], uvs[ 3 ], c );
		const d = this.vertex( p2[ 0 ], p2[ 1 ], p2[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 4 ], uvs[ 5 ], c );
		const e = this.vertex( p3[ 0 ], p3[ 1 ], p3[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 6 ], uvs[ 7 ], c );
		this.idx.push( a, b, d, a, d, e );

	}

	tri( p0, p1, p2, uvs, c ) {

		const n = faceNormal( p0, p1, p2 );
		const a = this.vertex( p0[ 0 ], p0[ 1 ], p0[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 0 ], uvs[ 1 ], c );
		const b = this.vertex( p1[ 0 ], p1[ 1 ], p1[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 2 ], uvs[ 3 ], c );
		const d = this.vertex( p2[ 0 ], p2[ 1 ], p2[ 2 ], n[ 0 ], n[ 1 ], n[ 2 ], uvs[ 4 ], uvs[ 5 ], c );
		this.idx.push( a, b, d );

	}

	// Vertical wall from (x0,z0) to (x1,z1); outward normal is to the right of travel seen from above.
	// u runs along the wall in units of `uSize` metres, v runs up in units of `vSize`.
	wall( x0, z0, x1, z1, y0, y1, uSize, vSize, c, uOff = 0, vOff = 0 ) {

		const len = Math.hypot( x1 - x0, z1 - z0 );
		const u1 = uOff + len / uSize;
		const v0 = vOff, v1 = vOff + ( y1 - y0 ) / vSize;
		this.quad(
			[ x0, y0, z0 ], [ x1, y0, z1 ], [ x1, y1, z1 ], [ x0, y1, z0 ],
			[ uOff, v0, u1, v0, u1, v1, uOff, v1 ], c
		);

	}

	// Axis aligned box, all six faces (or a subset via `faces` string of "nsewtb").
	box( x0, y0, z0, x1, y1, z1, uvSize, c, faces = 'nsewtb' ) {

		if ( faces.includes( 's' ) ) this.wall( x0, z1, x1, z1, y0, y1, uvSize, uvSize, c );
		if ( faces.includes( 'e' ) ) this.wall( x1, z1, x1, z0, y0, y1, uvSize, uvSize, c );
		if ( faces.includes( 'n' ) ) this.wall( x1, z0, x0, z0, y0, y1, uvSize, uvSize, c );
		if ( faces.includes( 'w' ) ) this.wall( x0, z0, x0, z1, y0, y1, uvSize, uvSize, c );
		if ( faces.includes( 't' ) ) this.quad( [ x0, y1, z1 ], [ x1, y1, z1 ], [ x1, y1, z0 ], [ x0, y1, z0 ],
			[ x0 / uvSize, z1 / uvSize, x1 / uvSize, z1 / uvSize, x1 / uvSize, z0 / uvSize, x0 / uvSize, z0 / uvSize ], c );
		if ( faces.includes( 'b' ) ) this.quad( [ x0, y0, z0 ], [ x1, y0, z0 ], [ x1, y0, z1 ], [ x0, y0, z1 ],
			[ 0, 0, 1, 0, 1, 1, 0, 1 ], c );

	}

	get empty() {

		return this.count === 0;

	}

	toGeometry() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( this.nrm, 3 ) );
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( this.uv, 2 ) );
		g.setAttribute( 'color', new THREE.Float32BufferAttribute( this.col, 3 ) );
		g.setIndex( this.count > 65535 ? new THREE.Uint32BufferAttribute( this.idx, 1 ) : new THREE.Uint16BufferAttribute( this.idx, 1 ) );
		g.computeBoundingSphere();
		g.computeBoundingBox();
		return g;

	}

}

function faceNormal( a, b, c ) {

	const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
	const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
	let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
	const l = Math.hypot( nx, ny, nz ) || 1;
	nx /= l; ny /= l; nz /= l;
	return [ nx, ny, nz ];

}

// Batches keyed by "chunk|material" so that big cities still frustum cull per chunk.
export class ChunkedBatches {

	constructor( chunkSize = 160 ) {

		this.chunkSize = chunkSize;
		this.map = new Map();

	}

	get( x, z, matKey ) {

		const cx = Math.floor( x / this.chunkSize ), cz = Math.floor( z / this.chunkSize );
		const key = cx + ',' + cz + '|' + matKey;
		let b = this.map.get( key );
		if ( ! b ) {

			b = new GeoBatch();
			b.matKey = matKey;
			this.map.set( key, b );

		}

		return b;

	}

	build( materials, parent, { castShadow = true, receiveShadow = true } = {} ) {

		const meshes = [];
		for ( const b of this.map.values() ) {

			if ( b.empty ) continue;
			const mesh = new THREE.Mesh( b.toGeometry(), materials[ b.matKey ] );
			mesh.castShadow = castShadow;
			mesh.receiveShadow = receiveShadow;
			mesh.matrixAutoUpdate = false;
			mesh.updateMatrix();
			parent.add( mesh );
			meshes.push( mesh );

		}

		this.map.clear();
		return meshes;

	}

}
