// The wire protocol, mirroring server.py.

export const HEALTH_STATES = [
  'Susceptible',
  'Exposed',
  'Infected',
  'Dire',
  'Recovered',
  'Dead',
] as const

export type HealthState = number // 0..5, index into HEALTH_STATES
export const N_STATES = HEALTH_STATES.length

export type Counts = number[] // length N_STATES, indexed by HealthState

export interface NodeMeta {
  id: number
  household: number
  office: number
  officeType: number
  age: number
  health: HealthState
}

export interface Point {
  x: number
  y: number
}

export interface InitMessage {
  type: 'init'
  seed: number
  populationSize: number
  initInfected: number
  disease: Record<string, number>
  nodes: NodeMeta[]
  edges: [number, number][]
  layout: Point[]
  counts: Counts
  maxSteps: number
}

export interface Frame {
  t: number
  counts: Counts
  changed: [number, HealthState][]
}

export interface FramesMessage {
  type: 'frames'
  frames: Frame[]
}

export interface StatusMessage {
  type: 'status'
  running: boolean
  t: number
  speed: number
  maxSteps: number
  over: boolean
  atEnd: boolean
  message: string | null
}

export interface PersonDetail {
  id: number
  health: HealthState
  age: number
  isObese: boolean
  isSmoker: boolean
  isAsthmatic: boolean
  household: { id: number; wealth: number; hasCar: boolean; size: number } | null
  office: { id: number; type: string; size: number } | null
  degree: number
  neighbourCounts: Counts
}

export interface PersonMessage {
  type: 'person'
  person: PersonDetail
}

export interface BuildingMessage {
  type: 'building'
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export type ServerMessage =
  | InitMessage
  | FramesMessage
  | StatusMessage
  | PersonMessage
  | BuildingMessage
  | ErrorMessage

export interface DiseaseField {
  name: string
  symbol: string
  description: string
  default: number
  min: number
  max: number
}

export interface Schema {
  disease: DiseaseField[]
  healthStates: string[]
  officeTypes: string[]
  limits: { maxPopulation: number; maxSteps: number; defaultSteps: number }
}

export interface SimParams {
  populationSize: number
  initInfected: number
  seed: number | null
  maxSteps: number
  disease: Record<string, number>
}

export type Command =
  | { cmd: 'run' }
  | { cmd: 'pause' }
  | { cmd: 'step' }
  | { cmd: 'status' }
  | { cmd: 'reset'; params: SimParams }
  | { cmd: 'speed'; value: number }
  | { cmd: 'inspect'; id: number }
