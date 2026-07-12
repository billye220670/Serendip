export interface P2VWorkflow {
  id: number
  name: string
}

export const P2V_WORKFLOWS: P2VWorkflow[] = [
  { id: 0, name: '二次元转真人' },
  { id: 1, name: '真人精修' },
  { id: 2, name: '精修放大' },
  { id: 3, name: '图生视频' },
  { id: 4, name: '视频补帧' },
  { id: 5, name: '解除装备' },
  { id: 6, name: '真人转二次元' },
  { id: 7, name: '快速出图' },
  { id: 8, name: '黑兽换脸' },
  { id: 9, name: 'ZIT快出' },
  { id: 10, name: '区域编辑' }
]
