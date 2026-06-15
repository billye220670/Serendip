/**
 * 瀑布流单元格外层定位 div 的样式。
 *
 * 除了 react-photo-album 给的宽高，再叠加 `content-visibility: auto`：
 * 视口外的卡片浏览器会跳过其布局与绘制，深滚后仍能保持流畅；
 * 配合 `contain-intrinsic-size` 给出占位尺寸，避免滚动条跳动。
 */
export function photoCellStyle(width: number, height: number): React.CSSProperties {
  return {
    width,
    height,
    contentVisibility: 'auto',
    containIntrinsicSize: `${Math.round(width)}px ${Math.round(height)}px`
  }
}
