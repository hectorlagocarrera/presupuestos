// Versión de la aplicación y novedades de cada una (la primera de la lista es la actual).
// Al publicar cambios: nueva entrada arriba (x.y.z: z = arreglos, y = funciones nuevas, x = cambios grandes)
// y el mismo número en package.json (lo comprueban los tests).
export const NOVEDADES = [
  {
    version: '1.0.2', fecha: '2026-10-20', cambios: [
      'Partes de trabajo: más espacio entre el buscador y los botones de estado.',
      'El aviso de versión nueva solo sale cuando la del servidor es más reciente.',
    ],
  },
  {
    version: '1.0.1', fecha: '2026-10-20', cambios: [
      'La aplicación pasa a llamarse «Omega Gestión».',
    ],
  },
  {
    version: '1.0.0', fecha: '2026-10-20', cambios: [
      'Primera versión numerada. Se ve en Ajustes → Novedades, y la aplicación avisa cuando hay una versión nueva en el servidor.',
      'Albaranes, presupuestos y facturas con su numeración; importación de los PDF del programa de gestión sin duplicados.',
      'Buscador histórico y referencias de precios al hacer un albarán, con filtro por cliente («Ver lo que se le ha hecho a…»).',
      'Tarifa sacada del histórico y tarifa oficial importada desde PDF o Excel.',
      'Partes de trabajo con firma del cliente (en el móvil o a distancia), copia por correo y WhatsApp, y descarga del albarán firmado.',
      'Usuarios con permisos, operarios que solo ven los partes, verificación en dos pasos y copias de seguridad diarias.',
    ],
  },
];
export const VERSION = NOVEDADES[0].version;
