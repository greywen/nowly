import type { FrameBox } from './frame-geometry';
export function currentImageBox(box:FrameBox,image:HTMLImageElement|null):FrameBox {if(!image)return box;const rect=image.getBoundingClientRect();return {...box,renderedWidth:rect.width,renderedHeight:rect.height,offsetX:rect.left,offsetY:rect.top};}
