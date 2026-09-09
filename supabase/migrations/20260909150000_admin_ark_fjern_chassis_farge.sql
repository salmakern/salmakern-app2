-- Fjerner den manuelle fargeoverstyringen på Chassis.nr igjen (kun rukket å være i bruk i
-- noen minutter, aldri satt av en ekte bruker) - Henrik ønsket i stedet at fargen KUN er
-- automatisk fra ordrens status, og at en endring av "farge" skjer ved å endre ordrens
-- status i selve ordren, ikke via en egen overstyring i Admin-ark. Se js/admin-ark.js.
alter table admin_ark drop column if exists chassis_farge;
