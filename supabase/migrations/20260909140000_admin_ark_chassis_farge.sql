-- Manuell fargeoverstyring på Chassis.nr-cellen i Admin-ark (uavhengig av den automatiske
-- fargen fra ordrens status) - se adminArkSettChassisFarge()/kolonneformatteren for
-- Chassis.nr i js/admin-ark.js. Tom streng/null = ingen overstyring, vis automatisk
-- status-farge (eller ingen farge om raden ikke matcher noen ordre).
alter table admin_ark add column if not exists chassis_farge text;
