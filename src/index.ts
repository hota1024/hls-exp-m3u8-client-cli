import * as npath from 'path'
import * as fs from 'fs-extra'
import { fetchM3u8 } from './M3u8'
import { Decoder } from 'ts-coder'
import axios from 'axios'
import * as axiosRetry from 'axios-retry'
// eslint-disable-next-line @typescript-eslint/ban-types
import { waitFor } from './waitFor'
;((axiosRetry as unknown) as Function)(axios, { retries: 3 })

let allStartAt = 0
let allPaths = 0
let frameCount = 0
let tsCount = 0

const jwt =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNjA5NjYxNjE3fQ.jSpjt0hjgvNJZSbQhukmFF2AZ0jyPou0yfn-dtGgu-o'
const cwd = process.cwd()
const camerasPath = npath.join(cwd, 'cameras')

// if (fs.pathExists(camerasPath)) {
//   fs.removeSync(camerasPath)
//   fs.mkdirSync(camerasPath)
// }

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
  const start = Date.now()

  decoder.onData((buffer) => {
    frameCount++
    console.log(
      `${details.camera}/${details.frame}.bin`,
      `${Date.now() - start}ms`,
      frameCount
    )
    if (frameCount === 100) {
      console.log('end: ', Date.now() - allStartAt, 'ms')
    }
    fs.writeFile(
      npath.join(camerasPath, `${details.camera}/${details.frame}.bin`),
      buffer
    )

    // console.log(`${frameCount} ${Date.now() - allStartAt}ms`)
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
  let numOfProcess = 0

  for (const path of paths) {
    const details = getPathDetails(path)

    const state =
      states.find(({ frame }) => frame === details.frame) ??
      (() => {
        const state = createState(details)
        states.push(state)
        return state
      })()

    /**
     * - フレームごとのTSを並列で取得する
     * - M3U8にではなくbinを載せる
     */

    console.time(`${path}`)
    numOfProcess++
    axios
      .get(`${url}/${path}`, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      })
      .then((r) => r.data)
      .then((buffer) => {
        tsCount++
        state.tsList.push({
          index: details.tsIndex,
          buffer,
        })
        numOfProcess--
        console.timeEnd(`${path}`)
      })
      .then(() => void 0)
      .catch((r) => console.log('err', r.config.url))

    console.log(`waiting... current: ${numOfProcess}`)
    // eslint-disable-next-line no-empty
    while (numOfProcess >= 30) {
      await waitFor(1)
    }
    console.log(`done... current: ${numOfProcess}`)
  }

  for (const state of states) {
    const sorted = state.tsList.sort((a, b) => a.index - b.index)
    sorted.forEach((ts) => state.decoder.push(ts.buffer))
    console.log(state.frame)
  }
}

async function startWatch(cameraId: number) {
  const dirPath = npath.join(camerasPath, cameraId.toString())
  if (fs.pathExistsSync(dirPath)) {
    await fs.remove(dirPath)
    console.log(`removed: ${dirPath}`)
  }
  fs.mkdirSync(dirPath)
  const url = `http://3.112.70.1:8000/api/streams`
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

  let isReady = false

  while (true as const) {
    /**
     * - 最大 100 件の ts へのパスが記載されている
     */
    const m3u8 = await fetchM3u8(m3u8Url)

    if (!isReady) {
      console.log(`watching ${m3u8Url}`)
      allStartAt = Date.now()
      isReady = true
    }

    allPaths = Math.max(allPaths, m3u8.paths.length)

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

startWatch(parseInt(process.argv[2]))

// ;(async () => {
//   const urls: string[] = []

//   for (let i = 0; i < 11; ++i) {
//     urls.push(`http://3.112.70.1:8000/api/streams/1/1/${i}.ts`)
//   }
//   console.log(urls)

//   const promises = urls.map((url) =>
//     axios.get(url, {
//       responseType: 'arraybuffer',
//       headers: {
//         Authorization: `Bearer ${jwt}`,
//       },
//     })
//   )

//   console.time('requests')
//   await Promise.all(promises)
//   console.timeEnd('requests')
// })()
