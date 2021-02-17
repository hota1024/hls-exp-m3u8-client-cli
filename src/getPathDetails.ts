const PATH_DETIALS_EXP = /(\d+)\/(\d+)\/(\d+).ts/

export type PathDetails = {
  camera: number
  frame: number
  tsIndex: number
}

export const getPathDetails = (path: string): PathDetails => {
  const matches = path.match(PATH_DETIALS_EXP)

  return {
    camera: parseInt(matches[1]),
    frame: parseInt(matches[2]),
    tsIndex: parseInt(matches[3]),
  }
}
