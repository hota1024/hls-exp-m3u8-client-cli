import * as npath from 'path'
import * as fs from 'fs-extra'
import { fetchM3u8 } from './M3u8'
import { Decoder } from 'ts-coder'
import axios from 'axios'
import * as axiosRetry from 'axios-retry'
// eslint-disable-next-line @typescript-eslint/ban-types
;((axiosRetry as unknown) as Function)(axios, { retries: 3 })

const jwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNjEwNTgwNzI0fQ.vQ7FhEnlbAM-xYAiAF8sEFfApr0fjTT-kjJcDZ_9Qls'
const cwd = process.cwd()
const camerasPath = npath.join(cwd, 'cameras')

fs.removeSync(camerasPath)
fs.mkdirSync(camerasPath)

const PATH_DETIALS_EXP = /(\d+)\/(\d+)\/(\d+).ts/

type PathDetails = {
  camera: number
  frame: number
  tsIndex: number
}

const getPathDetails = (path: string): PathDetails => {
  const matches = path.match(PATH_DETIALS_EXP)

  return {
    camera: parseInt(matches[1]),
    frame: parseInt(matches[2]),
    tsIndex: parseInt(matches[3]),
  }
}

const createDecoder = () => {
  const decoder = new Decoder({
    headSize: 4,
    isEnd(head) {
      return head[0] === 0x02
    },
  })

  return decoder
}

const createState = (details: PathDetails): DecodeState => {
  const decoder = createDecoder()

  decoder.onData((buffer) => {
    console.log(
      npath.join(camerasPath, `${details.camera}/${details.frame}.bin`)
    )
    fs.writeFile(
      npath.join(camerasPath, `${details.camera}/${details.frame}.bin`),
      buffer
    )
  })

  return {
    frame: details.frame,
    decoder: decoder,
    tsList: [],
  }
}

type Ts = {
  index: number
  buffer: Buffer
}

type DecodeState = {
  frame: number
  decoder: Decoder
  tsList: Ts[]
}

const decodePaths = async (url: string, paths: string[]) => {
  const states: DecodeState[] = []
  const promises: Promise<void>[] = []

  for (const path of paths) {
    const details = getPathDetails(path)

    const state =
      states.find(({ frame }) => frame === details.frame) ??
      (() => {
        const state = createState(details)
        states.push(state)
        return state
      })()

    await axios
      .get(`${url}/${path}`, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      })
      .then((r) => r.data)
      .then((buffer) =>
        state.tsList.push({
          index: details.tsIndex,
          buffer,
        })
      )
      .then(() => void 0)
      .catch((r) => console.log('err', r.config.url))
  }

  await Promise.all(promises)

  for (const state of states) {
    const sorted = state.tsList.sort((a, b) => a.index - b.index)
    sorted.forEach((ts) => state.decoder.push(ts.buffer))
  }
}

async function startWatch(cameraId: number) {
  fs.mkdirSync(npath.join(camerasPath, cameraId.toString()))
  const url = `http://localhost:8000/api/streams`
  const m3u8Url = `${url}/${cameraId}.m3u8`

  /**
   * - 読み込み済みの ts のパス
   */
  const loadedPaths: string[] = []

  /**
   * 1. 33ms以下で生成すること
   * 2. 並列で生成を行うこと
   * 3. pathsの重複処理が行われていること
   */

  while (true as const) {
    /**
     * - 最大 100 件の ts へのパスが記載されている
     */
    const m3u8 = await fetchM3u8(m3u8Url)

    /**
     * - 重複排除
     */
    const paths = m3u8.paths.filter((p) => !loadedPaths.includes(p))
    loadedPaths.push(...paths)

    if (paths.length === 0) {
      continue
    }

    decodePaths(url, paths)
  }
}

startWatch(1)
// startWatch(2)
// startWatch(3)
