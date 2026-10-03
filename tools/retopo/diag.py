import bpy
SP='/tmp/claude-0/-home-user-newport/1dd5c45b-9760-5e49-be89-8893902b832d/scratchpad'
bpy.ops.wm.open_mainfile(filepath=SP+'/catkid-retopo.blend')
arm=bpy.data.objects['Armature']
for n in ['upperArmL','forearmL','handL','chest']:
    pb=arm.pose.bones[n]; b=arm.data.bones[n]
    print(n,'pose rot',[round(v,3) for v in pb.rotation_quaternion],'rest head',[round(v,3) for v in b.head_local],'tail',[round(v,3) for v in b.tail_local])
dg=bpy.context.evaluated_depsgraph_get()
for name in ['arms','tee']:
    ob=bpy.data.objects[name]
    print(name,'modifiers',[(m.name,m.type) for m in ob.modifiers])
    raw=[v.co for v in ob.data.vertices]
    ev=ob.evaluated_get(dg).to_mesh()
    import mathutils
    xs=[v.co.x for v in ev.vertices]; zs=[v.co.z for v in ev.vertices]
    rx=[v.x for v in raw]; rz=[v.z for v in raw]
    print(name,'raw x',round(min(rx),2),round(max(rx),2),'z',round(min(rz),2),round(max(rz),2),' evaluated x',round(min(xs),2),round(max(xs),2),'z',round(min(zs),2),round(max(zs),2))
    vg={g.name:0 for g in ob.vertex_groups}
    for v in ob.data.vertices:
        for g in v.groups:
            if g.weight>0.01: vg[ob.vertex_groups[g.group].name]+=1
    print(name,'groups',{k:v for k,v in vg.items() if v})
