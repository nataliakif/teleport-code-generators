import { StringUtils } from '@teleporthq/teleport-shared'
import {
  GeneratorOptions,
  UIDLLinkNode,
  UIDLElementNode,
  UIDLAttributeValue,
} from '@teleporthq/teleport-types'
import { join } from 'path'

export const insertLinks = (
  node: UIDLElementNode,
  options: GeneratorOptions,
  linkInParent: boolean = false,
  parentNode?: UIDLElementNode
): UIDLElementNode => {
  // TODO_NOW
  const { abilities, children, elementType, semanticType } = node.content
  const linkInNode = linkInParent || !!abilities?.link

  // TODO: think of a way to reuse the traversal that modifies the tree
  node.content.children = children?.map((child) => {
    if (child.type === 'element') {
      return insertLinks(child, options, linkInNode, node)
    }

    if (child.type === 'repeat') {
      child.content.node = insertLinks(child.content.node, options, linkInNode, node)
    }

    if (child.type === 'conditional' && child.content.node.type === 'element') {
      child.content.node = insertLinks(child.content.node, options, linkInNode, node)
    }

    if (child.type === 'slot' && child.content.fallback?.type === 'element') {
      child.content.fallback = insertLinks(child.content.fallback, options, linkInNode, node)
    }

    return child
  })

  if (abilities?.link) {
    if (linkInParent) {
      console.warn('parent node has a link capability, nesting links is illegal')
      return node
    }

    /* type attribute is not valid for `anchor` tags */
    if (node.content?.attrs?.type) {
      delete node.content.attrs.type
    }

    /* We repalce buttons with link to use <a> tag's, to make the generated
    code to be semantically correct. */
    if (elementType === 'button') {
      node.content.elementType = getLinkElementType(abilities.link)
      node.content.semanticType = ''
      node.content.attrs = {
        ...node.content.attrs,
        ...createLinkAttributes(abilities.link, options),
      }
      return node
    }

    /* a text node (span) on which we added a link gets transformed into an <a>
     the rest of the text elements get wrapped with an <a> tag */
    if (elementType === 'text' && semanticType === 'span') {
      node.content.elementType = getLinkElementType(abilities.link)
      node.content.semanticType = ''
      node.content.attrs = {
        ...node.content.attrs,
        ...createLinkAttributes(abilities.link, options),
      }

      return node
    }

    const linkNode = createLinkNode(abilities.link, options)
    linkNode.content.children.push(node)

    if (parentNode?.content.style?.display?.content === 'flex') {
      linkNode.content.style = {
        ...linkNode.content.style,
        display: { type: 'static', content: 'contents' },
      }
    }

    return linkNode
  }

  return node
}

export const createLinkNode = (link: UIDLLinkNode, options: GeneratorOptions): UIDLElementNode => {
  return {
    type: 'element',
    content: {
      elementType: getLinkElementType(link),
      attrs: createLinkAttributes(link, options),
      children: [],
    },
  }
}

const getLinkElementType = (link: UIDLLinkNode): string => {
  return link.type === 'navlink' ? 'navlink' : 'link'
}

const createLinkAttributes = (
  link: UIDLLinkNode,
  options: GeneratorOptions
): Record<string, UIDLAttributeValue> => {
  switch (link.type) {
    case 'url': {
      return {
        url: link.content.url,
        ...(link.content.newTab
          ? {
              target: {
                type: 'static',
                content: '_blank',
              },
              rel: {
                type: 'static',
                content: 'noreferrer noopener',
              },
            }
          : {}),
      }
    }

    case 'section': {
      return {
        url: {
          type: 'static',
          content: `#${link.content.section}`,
        },
      }
    }

    case 'navlink': {
      return {
        transitionTo: {
          type: 'static',
          content: resolveNavlink(link.content.routeName, options),
        },
      }
    }

    case 'mail': {
      let mailUrl = `mailto:${link.content.mail}?subject=${link.content.subject ?? ''}`
      if (link.content.body) {
        mailUrl = mailUrl + `&body=${link.content.body}`
      }

      return {
        url: { type: 'static', content: mailUrl },
      }
    }

    case 'phone': {
      return {
        url: { type: 'static', content: `tel:${link.content.phone}` },
      }
    }

    default:
      throw new Error(
        `createLinkNode called with invalid link type '${(link as UIDLLinkNode).type}'`
      )
  }
}

const resolveNavlink = (routeName: string, options: GeneratorOptions) => {
  if (options.skipNavlinkResolver) {
    return routeName
  }

  if (routeName.startsWith('/')) {
    // attribute was explicitly set as a custom navlink
    return routeName
  }

  const friendlyURL = StringUtils.camelCaseToDashCase(
    StringUtils.removeIllegalCharacters(routeName)
  )

  const transitionRoute = options.projectRouteDefinition
    ? options.projectRouteDefinition.values.find((route) => route.value === routeName)
    : null

  if (!transitionRoute) {
    return `/${friendlyURL}`
  }

  if (transitionRoute?.pageOptions?.navLink === '/') {
    return transitionRoute.pageOptions.navLink
  }

  /*
    We are using `navLink` + fileName for the target location calculation.
    See `teleport-project-generator` -> createPageUIDL for more info.
  */

  return transitionRoute?.pageOptions?.navLink && transitionRoute?.pageOptions?.fileName
    ? join(transitionRoute.pageOptions.navLink, `../${transitionRoute.pageOptions.fileName}`)
    : transitionRoute.pageOptions.navLink ?? `/${friendlyURL}`
}
