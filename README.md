# Doran — demo técnica de contratación en construcción

Esta prueba de concepto demuestra un recorrido completo con información persistente en Supabase: publicar una vacante, descubrirla en mapa/listado, postularse, compartir el contacto con autorización, registrar contacto y seleccionar un candidato. No es una entrega para producción. El refinamiento se concentra en comportamiento técnico, datos y prueba del recorrido.

## Alcance acordado

- Pereira como ciudad de referencia de la demo.
- Trabajador y contratante, con un rol fijo por cuenta y un oficio principal por trabajador.
- Registro por correo y contraseña **sin confirmación de correo electrónico**.
- Contratantes aprobados manualmente desde Supabase, según el esquema existente.
- Una vacante por oferta, con oficio, descripción, ubicación, fechas y pago diario, fijo o a convenir.
- Mapa interactivo y listado de ofertas con filtro por oficio.
- En web, un único mapa ocupa toda la vista, con explorador a la izquierda y detalle/formulario a la derecha. Ambos paneles se pueden ocultar. En móvil se muestra un panel inferior a la vez.
- Mapa y listado de trabajadores disponibles para contratantes aprobados, sin revelar el celular en el descubrimiento.
- Selección de ubicación de obra y zona aproximada de trabajo tocando el mapa; también se admite ingresar las coordenadas de la obra.
- Tocar un punto vacío como trabajador abre dos opciones: **Ofrecer mi trabajo aquí** y **Postularme a una oferta**. La primera crea una publicación independiente y conserva las anteriores; la segunda requiere elegir una vacante publicada. El botón **Trabajo y postulaciones** abre las mismas rutas sin depender del clic en mapa.
- Postulación, consentimiento explícito de contacto, seguimiento, WhatsApp, confirmación de contacto, descarte, retiro y selección.
- Seleccionar cubre la vacante y descarta las demás postulaciones activas, en una sola transacción de BD.

No se agregan políticas legales, pagos, nómina, contratos digitales, chat interno, reputación, IA, cuadrillas ni un backend adicional.

Cada publicación de disponibilidad se guarda en `worker_publications` con su oficio, experiencia, radio y ubicación aproximada. Volver a publicar agrega un punto y no mueve los anteriores. El perfil conserva sus datos generales. La migración rescata la última zona disponible del perfil; las zonas sobrescritas antes de este cambio no tienen historial recuperable. El celular conserva las restricciones existentes de consentimiento por postulación.

### Ejemplos de Pereira

`supabase/seed-demo.sql` agrega cinco trabajadores ficticios y cuatro vacantes en Centro, Pinares, Cuba, Boston y Cerritos. Todos llevan la etiqueta `[DEMO]`; no tienen contraseñas, identidades de acceso ni contactos. El script se puede repetir sin duplicar registros y no modifica perfiles reales. Las vacantes tienen inicio a 30 días de ejecutar el script y luego caducan; no se renuevan automáticamente.

Los trabajadores ven sus publicaciones, los ejemplos DEMO y las vacantes vigentes. Los contratantes aprobados pueden consultar las publicaciones de trabajadores desde **Trabajadores**. Azul identifica tus publicaciones, verde las de otros trabajadores y naranja las vacantes. Los datos DEMO se almacenan en Supabase y las postulaciones a vacantes DEMO se guardan, pero ninguna empresa real responderá.

## Lo que ya había y lo que se completa

La migración inicial ya implementaba tablas, RLS y las siete funciones de negocio. El front llegaba hasta acceso y perfiles. Esta entrega conecta esas funciones al recorrido y agrega mapas con Leaflet y OpenStreetMap. No duplica en React las transiciones de la BD.

También corrige el reintento cuando se guarda el perfil pero falla guardar el celular: se actualiza el perfil creado, sin intentar insertarlo otra vez. El rol se toma de `profiles`; los metadatos de Auth no son la fuente de autorización. Renovar la sesión ya no devuelve al usuario al inicio del perfil.

La confirmación de correo está desactivada localmente (`auth.email.enable_confirmations = false`). El 13 de octubre de 2026, la configuración Auth remota también respondió `mailer_autoconfirm: true`, con registro habilitado. El correo sigue siendo el identificador de acceso.

## Reglas reales del código

| Regla | Comportamiento |
| --- | --- |
| Postulación | Exige celular y consentimiento `contact-v1`. Solo una por trabajador y oferta; una retirada no puede reactivarse. |
| Oficio y disponibilidad | Se muestran y filtran, pero la BD no exige coincidencia de oficio ni disponibilidad para postularse. |
| WhatsApp | Registra un intento de abrir; no demuestra contacto ni contratación. |
| Contacto | El contratante lo confirma explícitamente, incluso si utilizó otro medio. |
| Selección | Exige contacto confirmado y deja exactamente un candidato seleccionado. |
| Retiro | Solo desde `submitted`. Retirar todas las postulaciones a un contratante corta su acceso futuro al celular. |
| Rechazo/selección | La regla existente conserva el acceso al teléfono para ese contratante. |
| Cancelación | Cierra la vacante y descarta las postulaciones activas. No hay reapertura. |
| Fecha | Pasado `start_date`, la BD rechaza nuevas postulaciones aunque la oferta siga abierta. El trabajador no la ve como oportunidad vigente; el dueño conserva la gestión de sus candidatos. |
| Remuneración | Importe entero entre $20.000 y $2.000.000 COP para diario/fijo; importe nulo si es a convenir. |

Una vacante cubierta demuestra selección dentro de la aplicación, no una contratación verificada. El criterio de éxito de esta demo es que dos cuentas completen el recorrido y conserven su estado al volver a entrar.

## Cómo probar la demo

1. Crear un contratante y un trabajador; guardar sus perfiles y celulares sin confirmar correo.
2. Aprobar al contratante en Supabase usando su UUID de `profiles`, con acceso administrativo. No colocar credenciales administrativas en el navegador.
3. Pulsar **Crear oferta** o tocar un punto vacío como contratante. Completar trabajo, pago/fechas y ubicación. Ocultar y reabrir el formulario debe conservar el borrador. Publicar y verificar que el marcador y el listado muestran los mismos datos.
4. Entrar como trabajador y tocar un punto vacío. Elegir **Ofrecer mi trabajo aquí**, completar oficio/experiencia/radio y publicar disponibilidad. Recargar debe recuperar la zona aproximada y el radio. Puede hacerse sin ofertas publicadas.
5. Tocar otro punto y elegir **Postularme a una oferta**. Seleccionar una vacante publicada, revisar el perfil, agregar un mensaje opcional y enviar con autorización explícita. También se conserva el acceso desde el marcador de la oferta mediante **Postularme a esta oferta**.
6. Volver como contratante, revisar al candidato, abrir WhatsApp y comprobar que sigue pendiente de contacto.
7. Confirmar contacto y seleccionar. La vacante debe quedar cubierta y desaparecer de las oportunidades abiertas.
8. Volver como trabajador: la oferta cubierta y su selección deben seguir visibles en Mis postulaciones.
9. Recargar y cambiar de cuenta. Un contratante ajeno no debe leer ese celular ni gestionar esas postulaciones.
10. Verificar además retiro, descarte, cancelación y bloqueo de postulación duplicada.

No asumir que la conexión a Supabase demuestra todo esto: Auth, REST, RLS y la interfaz deben funcionar juntos. El costo de dejar solo registro/perfiles era no poder demostrar la conexión entre ambas partes; el recorrido y el mapa permiten probarla ahora.

## Desarrollo y evidencia

```sh
npm ci
# Crear .env desde .env.example si todavía no existe.
npm run dev
npm run test:profile
npm run test:offers
npm run build
```

El front usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; contraseña de BD, tokens administrativos y `service_role` permanecen fuera del navegador.

`tests/phase1.mjs` borra y recrea los esquemas de la BD a la que se conecta. Ejecutarlo únicamente en PostgreSQL local desechable, no en Supabase ni en una instancia con datos que quieras conservar:

```sh
docker run --detach --rm --name doran-flow-tests \
  -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:54330:5432 postgres:17
# Esperar a que PostgreSQL esté listo.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54330/postgres npm run test:db
docker stop doran-flow-tests
```

Los 31 tests de BD pasaron en PostgreSQL 17 aislado: privilegios, RLS, consentimiento, transiciones y selección concurrente. Simulan `auth.uid()` y no prueban Auth/REST remoto. Los controles de perfil/ofertas y el build también pasaron. Playwright comprobó el recorrido con respuestas de API simuladas, recarga, cambio de cuenta y reintentos después de fallar postulación o contacto. También comprobó marcadores de trabajadores, selección de coordenadas tocando el mapa y publicación con esas coordenadas. Las capturas locales están en `output/playwright/`.

La vista con paneles se comprobó a 1440 × 1000 y 390 × 844: un único mapa, creación en el panel derecho, borrador conservado al ocultarlo, consulta de trabajadores, formulario explícito de postulación, reintento sin perder mensaje y envío. En móvil no hay desplazamiento horizontal y se muestra un panel a la vez. Estos controles usan respuestas de API simuladas; no implican validación remota.

El clic en puntos vacíos se comprobó también con una API HTTP local desechable: ambas opciones del trabajador, disponibilidad sin vacantes, guardado y recuperación de zona/radio al recargar, creación de oferta por clic como contratante, elección de oferta, postulación con consentimiento y reintento tras un fallo. El test simulado rechaza que la actualización de disponibilidad intente escribir teléfono, rol, aprobación o versión de aceptación. Las pruebas de perfil cubren el redondeo y los límites de zona/radio. No se escribió información de prueba en Supabase remoto.

## Límites técnicos y siguientes ajustes pequeños

- El recorrido completo contra Supabase remoto sigue pendiente: la inspección SQL remota falló por DNS (`ENOTFOUND`). La configuración Auth sí pudo consultarse.
- El mapa depende de internet y de los tiles de OpenStreetMap. Si fallan, el listado y las coordenadas permanecen disponibles. No hay cálculo de distancias ni filtro geográfico por radio; la proximidad se explora visualmente.
- Se muestran las últimas 50 ofertas y hasta 50 trabajadores disponibles; el filtro de trabajadores se aplica en la consulta y el de ofertas sobre el lote cargado. Agregar paginación cuando la demo necesite más datos. Actualización manual, sin realtime.
- Pereira se fija en el front, sin validación geográfica estricta en BD. Los perfiles existentes pueden partir del centro como fallback si se negó geolocalización; el mapa permite elegir otra zona.
- Revisar `CHECK` nullable de experiencia/radio/coordenadas e importe de oferta: las restricciones actuales pueden aceptar NULL por escritura directa. Añadir restricciones explícitas en una nueva migración si se prueba ese caso.
- Unificar el día de Bogotá con la zona de la sesión SQL: el front usa `America/Bogota` y las funciones existentes usan `current_date`. Probar cerca del cambio de día.

Primero cerrar la prueba real con dos cuentas y los casos anteriores. Después ajustar los límites que esa prueba revele. No se necesita una arquitectura mayor para esta demo.
