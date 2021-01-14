import { PluginObj, types as t, NodePath, PluginPass } from '@babel/core';
import { addNamed as addNamedImport } from '@babel/helper-module-imports';
import * as nodePath from 'path';

function functionDeclarationToExpression(declaration: t.FunctionDeclaration) {
  return t.functionExpression(
    declaration.id,
    declaration.params,
    declaration.body,
    declaration.generator,
    declaration.async
  );
}

function classDeclarationToExpression(declaration: t.ClassDeclaration) {
  return t.classExpression(
    declaration.id,
    declaration.superClass,
    declaration.body,
    declaration.decorators
  );
}

function getFileName(state: PluginPass) {
  const { filename, cwd } = state;

  if (!filename) {
    return undefined;
  }

  if (cwd && filename.startsWith(cwd)) {
    return filename.slice(cwd.length);
  }

  return filename;
}

const functionsToReplace = ['getServerSideProps', 'getStaticProps'];

function transformPropGetters(
  path: NodePath<t.ExportNamedDeclaration>,
  transform: (v: t.Expression) => t.Expression
) {
  const { node } = path;

  if (t.isFunctionDeclaration(node.declaration)) {
    const { id: functionId } = node.declaration;
    if (!functionId) {
      return false;
    }

    if (!functionsToReplace.includes(functionId.name)) {
      return false;
    }

    node.declaration = t.variableDeclaration('const', [
      t.variableDeclarator(
        functionId,
        transform(functionDeclarationToExpression(node.declaration))
      ),
    ]);

    return true;
  }

  if (t.isVariableDeclaration(node.declaration)) {
    node.declaration.declarations.forEach((declaration) => {
      if (
        t.isIdentifier(declaration.id) &&
        functionsToReplace.includes(declaration.id.name) &&
        declaration.init
      ) {
        declaration.init = transform(declaration.init);
      }
    });
  }

  return true;
}

function addWithSuperJSONPropsImport(path: NodePath<any>) {
  return addNamedImport(
    path,
    'withSuperJSONProps',
    'babel-plugin-superjson-next/tools'
  );
}

function addWithSuperJSONPageImport(path: NodePath<any>) {
  return addNamedImport(
    path,
    'withSuperJSONPage',
    'babel-plugin-superjson-next/tools'
  );
}

function wrapExportDefaultDeclaration(path: NodePath<any>) {
  function wrapInHOC(expr: t.Expression): t.Expression {
    return t.callExpression(addWithSuperJSONPageImport(path), [expr]);
  }

  const { node } = path;

  if (t.isIdentifier(node.declaration)) {
    node.declaration = wrapInHOC(node.declaration);
  }

  if (t.isFunctionExpression(node.declaration)) {
    node.declaration = wrapInHOC(node.declaration);
  }

  if (
    t.isFunctionDeclaration(node.declaration) ||
    t.isClassDeclaration(node.declaration)
  ) {
    if (node.declaration.id) {
      path.insertBefore(node.declaration);
      node.declaration = wrapInHOC(node.declaration.id);
    } else {
      if (t.isFunctionDeclaration(node.declaration)) {
        node.declaration = wrapInHOC(
          functionDeclarationToExpression(node.declaration)
        );
      } else {
        node.declaration = wrapInHOC(
          classDeclarationToExpression(node.declaration)
        );
      }
    }
  }
}

function superJsonWithNext(): PluginObj {
  return {
    name: 'replace gSSP',
    visitor: {
      Program(path, state) {
        const filename =
          getFileName(state) ?? nodePath.join('pages', 'Default.js');
        if (!filename.includes('pages' + nodePath.sep)) {
          return;
        }

        const body = path.get('body');

        const exportNamedDeclaration = body.find((path) =>
          t.isExportNamedDeclaration(path)
        ) as NodePath<t.ExportNamedDeclaration> | undefined;
        if (!exportNamedDeclaration) {
          return;
        }

        const foundGSSP = transformPropGetters(exportNamedDeclaration, (decl) =>
          t.callExpression(addWithSuperJSONPropsImport(path), [decl])
        );
        if (!foundGSSP) {
          return;
        }

        const exportDefaultDeclaration = body.find((path) =>
          t.isExportDefaultDeclaration(path)
        );
        if (!exportDefaultDeclaration) {
          return;
        }

        wrapExportDefaultDeclaration(exportDefaultDeclaration);
      },
    },
  };
}

export default superJsonWithNext;
