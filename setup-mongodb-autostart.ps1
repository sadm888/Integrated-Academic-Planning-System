$action = New-ScheduledTaskAction `
  -Execute 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe' `
  -Argument '--config "C:\Users\Sadhana\mongod.cfg"'

$trigger = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName 'MongoDB IAPS' `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Force

Write-Host "MongoDB IAPS scheduled task created successfully."
