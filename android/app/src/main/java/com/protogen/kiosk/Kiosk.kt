package com.protogen.kiosk

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.provider.Settings
import android.util.Log

/**
 * Modo quiosque. Só tem efeito quando o app é "dono do aparelho" (device owner), configurado com:
 *   adb shell dpm set-device-owner com.protogen.kiosk/.AdminReceiver
 * Sem isso o app roda como um app comum.
 */
object Kiosk {
    private const val TAG = "Kiosk"

    private fun dpm(ctx: Context) = ctx.getSystemService(DevicePolicyManager::class.java)
    private fun admin(ctx: Context) = ComponentName(ctx, AdminReceiver::class.java)

    fun isOwner(ctx: Context) = dpm(ctx).isDeviceOwnerApp(ctx.packageName)

    /** Desligado por /sair até o app ser reaberto. */
    private var suspended = false

    fun enter(act: Activity) {
        if (!isOwner(act) || suspended) return
        val dpm = dpm(act)
        val admin = admin(act)
        try {
            dpm.setLockTaskPackages(admin, arrayOf(act.packageName))
            // Menu de energia continua disponível (para desligar/reiniciar)
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)

            // Este app vira a tela inicial fixa
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, home, ComponentName(act, MainActivity::class.java))

            dpm.setKeyguardDisabled(admin, true)
            dpm.setStatusBarDisabled(admin, true)
            dpm.setGlobalSetting(
                admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN,
                (BatteryManager.BATTERY_PLUGGED_AC or BatteryManager.BATTERY_PLUGGED_USB or
                    BatteryManager.BATTERY_PLUGGED_WIRELESS).toString()
            )
            dpm.setPermissionGrantState(
                admin, act.packageName, Manifest.permission.RECORD_AUDIO,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
            )

            val am = act.getSystemService(ActivityManager::class.java)
            if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) act.startLockTask()
        } catch (e: Exception) {
            Log.e(TAG, "falha ao entrar no quiosque", e)
        }
    }

    fun exit(act: Activity) {
        suspended = true
        if (!isOwner(act)) return
        val dpm = dpm(act)
        val admin = admin(act)
        runCatching { act.stopLockTask() }
        runCatching {
            dpm.clearPackagePersistentPreferredActivities(admin, act.packageName)
            dpm.setKeyguardDisabled(admin, false)
            dpm.setStatusBarDisabled(admin, false)
        }
    }

    /** Deixa de ser dono do aparelho. Depois disso o app pode ser desinstalado normalmente. */
    fun releaseOwner(act: Activity) {
        exit(act)
        runCatching { dpm(act).clearDeviceOwnerApp(act.packageName) }
            .onFailure { Log.e(TAG, "falha ao liberar dono", it) }
    }
}
