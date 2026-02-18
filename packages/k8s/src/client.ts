import * as k8s from '@kubernetes/client-node'

const kc = new k8s.KubeConfig()
kc.loadFromDefault()

export const coreV1 = kc.makeApiClient(k8s.CoreV1Api)
export const metricsClient = new k8s.Metrics(kc)
export const exec = new k8s.Exec(kc)
export const kubeConfig = kc
export const namespace = process.env.DASHBOARD_NAMESPACE || 'workspacekit'
