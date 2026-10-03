import bpy, time, sys
t=time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath='/home/user/newport/public/models/catkid-tpose.stl')
src=bpy.context.selected_objects[0]; src.name='sculpt'
print('imported',len(src.data.vertices),'verts',len(src.data.polygons),'faces',time.time()-t)
# test: a cylinder shrinkwrapped to the left arm
bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=0.05,depth=0.5,location=(0.45,0,1.43),rotation=(0,1.5708,0))
cyl=bpy.context.active_object
m=cyl.modifiers.new('sw','SHRINKWRAP'); m.target=src; m.wrap_method='NEAREST_SURFACEPOINT'
bpy.ops.object.modifier_apply(modifier='sw')
print('shrinkwrap ok', [round(v,3) for v in cyl.data.vertices[0].co], time.time()-t)
# armature + auto weights
bpy.ops.object.armature_add(location=(0,0,0))
arm=bpy.context.active_object
bpy.ops.object.mode_set(mode='EDIT')
b=arm.data.edit_bones[0]; b.head=(0.19,0,1.43); b.tail=(0.75,0,1.43)
bpy.ops.object.mode_set(mode='OBJECT')
cyl.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active=arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('auto weights ok', cyl.vertex_groups[:], time.time()-t)
# uv + export
bpy.context.view_layer.objects.active=cyl; bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); cyl.select_set(True); arm.select_set(True)
bpy.ops.export_scene.gltf(filepath='/tmp/claude-0/-home-user-newport/1dd5c45b-9760-5e49-be89-8893902b832d/scratchpad/probe.glb',use_selection=True,export_skins=True,export_morph=True)
print('export ok',time.time()-t)
